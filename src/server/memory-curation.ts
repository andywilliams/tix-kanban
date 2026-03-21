/**
 * Memory Curation System
 * 
 * Weekly LLM-powered review of memories to:
 * - Identify patterns and recurring lessons
 * - Promote important insights to project memory
 * - Flag contradictions or outdated information
 * - Generate "weekly learnings" digest
 */

import Anthropic from '@anthropic-ai/sdk';
import { getStructuredMemory, saveStructuredMemory, MemoryEntry } from './persona-memory.js';
import { addProjectMemoryEntry, ProjectMemoryCategory } from './project-memory.js';
import { archiveMemories } from './memory-archive.js';
import { deleteEmbedding } from './memory/index.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface CurationResult {
  personaId: string;
  memoriesReviewed: number;
  promotedToProject: number;
  importanceBoosted: number;
  flaggedForReview: number;
  archivedAsOutdated: number;
  digest: string;
  patterns: string[];
  contradictions: string[];
}

export interface CurationAction {
  type: 'promote' | 'boost' | 'flag' | 'archive' | 'note';
  memoryId: string;
  reason: string;
  projectCategory?: ProjectMemoryCategory;
  projectContent?: string;
}

/**
 * Curate memories for a single persona
 */
export async function curatePersonaMemories(
  personaId: string,
  personaName: string,
  dateRange: { start: Date; end: Date }
): Promise<CurationResult> {
  const memory = await getStructuredMemory(personaId);
  
  // Filter memories from the date range
  const recentMemories = memory.entries.filter(entry => {
    const created = new Date(entry.createdAt);
    return created >= dateRange.start && created <= dateRange.end;
  });
  
  if (recentMemories.length === 0) {
    return {
      personaId,
      memoriesReviewed: 0,
      promotedToProject: 0,
      importanceBoosted: 0,
      flaggedForReview: 0,
      archivedAsOutdated: 0,
      digest: 'No new memories to review this week.',
      patterns: [],
      contradictions: [],
    };
  }
  
  // Prepare memory context for LLM
  const memoryContext = formatMemoriesForCuration(recentMemories);
  
  // Call LLM for curation
  const curationAnalysis = await performCurationAnalysis(personaId, personaName, memoryContext);
  
  // Execute curation actions
  const result = await executeCurationActions(
    personaId,
    memory,
    curationAnalysis.actions
  );
  
  return {
    personaId,
    memoriesReviewed: recentMemories.length,
    promotedToProject: result.promotedToProject,
    importanceBoosted: result.importanceBoosted,
    flaggedForReview: result.flaggedForReview,
    archivedAsOutdated: result.archivedAsOutdated,
    digest: curationAnalysis.digest,
    patterns: curationAnalysis.patterns,
    contradictions: curationAnalysis.contradictions,
  };
}

/**
 * Format memories for LLM analysis
 */
function formatMemoriesForCuration(memories: MemoryEntry[]): string {
  let context = '';
  
  for (const entry of memories) {
    context += `[${entry.id}] ${entry.category} (${entry.importance})\n`;
    context += `Content: ${entry.content}\n`;
    context += `Source: ${entry.source}\n`;
    context += `Created: ${new Date(entry.createdAt).toISOString().split('T')[0]}\n`;
    if (entry.tags.length > 0) {
      context += `Tags: ${entry.tags.join(', ')}\n`;
    }
    context += '\n';
  }
  
  return context;
}

/**
 * Perform LLM-based curation analysis
 */
async function performCurationAnalysis(
  personaId: string,
  personaName: string,
  memoryContext: string
): Promise<{
  actions: CurationAction[];
  digest: string;
  patterns: string[];
  contradictions: string[];
}> {
  const prompt = `You are reviewing a week's worth of memories for "${personaName}", a persona in a task management system.

# Memories to Review

${memoryContext}

# Your Task

Analyze these memories and provide:

1. **Actions**: Specific actions to take (format as JSON array):
   - "promote": Important insights that should be shared across all personas (add to project memory)
   - "boost": Memories that prove to be particularly valuable (increase importance)
   - "flag": Contradictions or memories that need human review
   - "archive": Outdated or superseded information
   - "note": General observations (no action needed)

2. **Digest**: A brief summary of key learnings this week (2-3 sentences)

3. **Patterns**: Recurring themes or lessons (bullet points)

4. **Contradictions**: Any conflicting information found

# Response Format

Respond in this exact format:

## Actions
\`\`\`json
[
  {
    "type": "promote",
    "memoryId": "mem_xxx",
    "reason": "Why this should be shared",
    "projectCategory": "lesson",
    "projectContent": "The insight to share"
  },
  {
    "type": "boost",
    "memoryId": "mem_yyy",
    "reason": "Why this is important"
  }
]
\`\`\`

## Digest
Brief summary of the week's learnings...

## Patterns
- Pattern 1
- Pattern 2

## Contradictions
- Contradiction 1 (or "None found")`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2000,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  const content = response.content[0].type === 'text' 
    ? response.content[0].text 
    : '';

  // Parse the response
  const actions = parseActions(content);
  const digest = parseSection(content, 'Digest');
  const patterns = parseBulletPoints(content, 'Patterns');
  const contradictions = parseBulletPoints(content, 'Contradictions');

  return { actions, digest, patterns, contradictions };
}

/**
 * Parse actions from LLM response
 */
function parseActions(content: string): CurationAction[] {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return [];
  
  try {
    return JSON.parse(jsonMatch[1]);
  } catch (error) {
    console.error('[Curation] Failed to parse actions JSON:', error);
    return [];
  }
}

/**
 * Parse a section from LLM response
 */
function parseSection(content: string, sectionName: string): string {
  const regex = new RegExp(`## ${sectionName}\\s*([\\s\\S]*?)(?=##|$)`);
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parse bullet points from a section
 */
function parseBulletPoints(content: string, sectionName: string): string[] {
  const section = parseSection(content, sectionName);
  if (!section) return [];
  
  const lines = section.split('\n');
  const bullets: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
      bullets.push(trimmed.slice(1).trim());
    }
  }
  
  return bullets;
}

/**
 * Execute curation actions
 */
async function executeCurationActions(
  personaId: string,
  memory: ReturnType<typeof getStructuredMemory> extends Promise<infer T> ? T : never,
  actions: CurationAction[]
): Promise<{
  promotedToProject: number;
  importanceBoosted: number;
  flaggedForReview: number;
  archivedAsOutdated: number;
}> {
  let promotedToProject = 0;
  let importanceBoosted = 0;
  let flaggedForReview = 0;
  let archivedAsOutdated = 0;
  
  const toArchive: MemoryEntry[] = [];
  
  for (const action of actions) {
    const entry = memory.entries.find(e => e.id === action.memoryId);
    if (!entry) continue;
    
    switch (action.type) {
      case 'promote':
        if (action.projectContent && action.projectCategory) {
          await addProjectMemoryEntry(
            action.projectCategory,
            action.projectContent,
            `${personaId} (curated)`,
            8  // High importance for curated insights
          );
          promotedToProject++;
        }
        break;
      
      case 'boost':
        if (entry.importance === 'low') {
          entry.importance = 'medium';
          importanceBoosted++;
        } else if (entry.importance === 'medium') {
          entry.importance = 'high';
          importanceBoosted++;
        }
        break;
      
      case 'flag':
        // Add a tag to flag for human review
        if (!entry.tags.includes('flagged-for-review')) {
          entry.tags.push('flagged-for-review');
        }
        flaggedForReview++;
        break;
      
      case 'archive':
        toArchive.push(entry);
        archivedAsOutdated++;
        break;
      
      case 'note':
        // No action needed - just an observation
        break;
    }
  }
  
  // Archive outdated entries
  if (toArchive.length > 0) {
    const archivedIds = new Set(toArchive.map(e => e.id));
    memory.entries = memory.entries.filter(e => !archivedIds.has(e.id));
  }
  
  // Save updated memory (after filtering out archived entries)
  await saveStructuredMemory(memory);
  
  // Archive outdated entries
  if (toArchive.length > 0) {
    await archiveMemories(personaId, toArchive, 'curation');
    
    // Clean up embeddings
    for (const entry of toArchive) {
      try {
        await deleteEmbedding(personaId, entry.id);
      } catch (err) {
        console.warn(`[Curation] Failed to delete embedding for entry ${entry.id}:`, err);
      }
    }
  }
  
  return {
    promotedToProject,
    importanceBoosted,
    flaggedForReview,
    archivedAsOutdated,
  };
}

/**
 * Curate memories for all personas
 */
export async function curateAllMemories(
  personas: Array<{ id: string; name: string }>,
  dateRange: { start: Date; end: Date }
): Promise<CurationResult[]> {
  const results: CurationResult[] = [];
  
  for (const persona of personas) {
    try {
      const result = await curatePersonaMemories(persona.id, persona.name, dateRange);
      results.push(result);
    } catch (error) {
      console.error(`[Curation] Failed to curate memories for persona ${persona.id}:`, error);
      results.push({
        personaId: persona.id,
        memoriesReviewed: 0,
        promotedToProject: 0,
        importanceBoosted: 0,
        flaggedForReview: 0,
        archivedAsOutdated: 0,
        digest: 'Error during curation',
        patterns: [],
        contradictions: [],
      });
    }
  }
  
  return results;
}

/**
 * Generate a combined weekly digest for all personas
 */
export function generateWeeklyDigest(results: CurationResult[]): string {
  let digest = '# Weekly Memory Curation Report\n\n';
  
  // Overall stats
  const totalReviewed = results.reduce((sum, r) => sum + r.memoriesReviewed, 0);
  const totalPromoted = results.reduce((sum, r) => sum + r.promotedToProject, 0);
  const totalBoosted = results.reduce((sum, r) => sum + r.importanceBoosted, 0);
  const totalFlagged = results.reduce((sum, r) => sum + r.flaggedForReview, 0);
  const totalArchived = results.reduce((sum, r) => sum + r.archivedAsOutdated, 0);
  
  digest += `## Summary\n\n`;
  digest += `- **Memories Reviewed**: ${totalReviewed}\n`;
  digest += `- **Promoted to Project Memory**: ${totalPromoted}\n`;
  digest += `- **Importance Boosted**: ${totalBoosted}\n`;
  digest += `- **Flagged for Review**: ${totalFlagged}\n`;
  digest += `- **Archived as Outdated**: ${totalArchived}\n\n`;
  
  // Per-persona insights
  for (const result of results) {
    if (result.memoriesReviewed === 0) continue;
    
    digest += `## ${result.personaId}\n\n`;
    digest += `${result.digest}\n\n`;
    
    if (result.patterns.length > 0) {
      digest += `**Patterns:**\n`;
      result.patterns.forEach(p => digest += `- ${p}\n`);
      digest += '\n';
    }
    
    if (result.contradictions.length > 0) {
      digest += `**Contradictions:**\n`;
      result.contradictions.forEach(c => digest += `- ${c}\n`);
      digest += '\n';
    }
  }
  
  return digest;
}
