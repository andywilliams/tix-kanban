import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Persona, PersonaStats } from '../client/types/index.js';
import { addMemoryEntry as addAgentMemoryEntry, buildTaskMemoryContext } from './agent-memory.js';
import { getAgentSoul, generateSoulPrompt, initializeSoulForPersona } from './agent-soul.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');
const PERSONAS_INDEX_FILE = path.join(STORAGE_DIR, 'personas-index.json');

interface PersonaIndex {
  [personaId: string]: {
    name: string;
    emoji: string;
    description: string;
    specialties: string[];
    stats: PersonaStats;
    createdAt: string;
    updatedAt: string;
  };
}

// Ensure storage directories exist
async function ensurePersonaDirectories(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.mkdir(PERSONAS_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create persona directories:', error);
    throw error;
  }
}

// Ensure persona-specific directory exists
async function ensurePersonaDirectory(personaId: string): Promise<void> {
  try {
    const personaDir = path.join(PERSONAS_DIR, personaId);
    await fs.mkdir(personaDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create persona directory for ${personaId}:`, error);
    throw error;
  }
}

// Read persona index for fast listing
async function readPersonaIndex(): Promise<PersonaIndex> {
  try {
    const content = await fs.readFile(PERSONAS_INDEX_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}; // File doesn't exist yet
    }
    console.error('Failed to read persona index:', error);
    throw error;
  }
}

// Write persona index
async function writePersonaIndex(index: PersonaIndex): Promise<void> {
  try {
    await ensurePersonaDirectories();
    const content = JSON.stringify(index, null, 2);
    await fs.writeFile(PERSONAS_INDEX_FILE, content, 'utf8');
  } catch (error) {
    console.error('Failed to write persona index:', error);
    throw error;
  }
}

// Read persona prompt from markdown file
async function readPersonaPrompt(personaId: string): Promise<string> {
  try {
    const promptPath = path.join(PERSONAS_DIR, `${personaId}.md`);
    const content = await fs.readFile(promptPath, 'utf8');
    
    // Parse front matter if it exists, otherwise return full content
    const lines = content.split('\n');
    if (lines[0] === '---') {
      let yamlEnd = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
        yamlEnd = i;
        break;
      }
      }
      return yamlEnd > 0 ? lines.slice(yamlEnd + 1).join('\n').trim() : content.trim();
    }
    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // File doesn't exist
    }
    console.error(`Failed to read persona prompt ${personaId}:`, error);
    throw error;
  }
}

// Write persona prompt to markdown file
async function writePersonaPrompt(personaId: string, prompt: string): Promise<void> {
  try {
    await ensurePersonaDirectories();
    const promptPath = path.join(PERSONAS_DIR, `${personaId}.md`);
    await fs.writeFile(promptPath, prompt, 'utf8');
  } catch (error) {
    console.error(`Failed to write persona prompt ${personaId}:`, error);
    throw error;
  }
}

// Delete persona prompt file
async function deletePersonaPrompt(personaId: string): Promise<void> {
  try {
    const promptPath = path.join(PERSONAS_DIR, `${personaId}.md`);
    await fs.unlink(promptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to delete persona prompt ${personaId}:`, error);
      throw error;
    }
  }
}

// Get all personas
export async function getAllPersonas(): Promise<Persona[]> {
  try {
    const index = await readPersonaIndex();
    const personas: Persona[] = [];
    
    for (const [id, data] of Object.entries(index)) {
      const prompt = await readPersonaPrompt(id);
      personas.push({
        id,
        name: data.name,
        emoji: data.emoji,
        description: data.description,
        specialties: data.specialties,
        stats: data.stats,
        prompt,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      });
    }
    
    return personas;
  } catch (error) {
    console.error('Failed to get all personas:', error);
    return [];
  }
}

// Get single persona
export async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    const index = await readPersonaIndex();
    const data = index[personaId];
    
    if (!data) {
      return null;
    }
    
    const prompt = await readPersonaPrompt(personaId);
    
    return {
      id: personaId,
      name: data.name,
      emoji: data.emoji,
      description: data.description,
      specialties: data.specialties,
      stats: data.stats,
      prompt,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  } catch (error) {
    console.error(`Failed to get persona ${personaId}:`, error);
    return null;
  }
}

// Create persona
export async function createPersona(personaData: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>): Promise<Persona> {
  try {
    // Generate ID from name
    const id = personaData.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    const now = new Date();
    const persona: Persona = {
      ...personaData,
      id,
      createdAt: now,
      updatedAt: now,
    };
    
    // Update index
    const index = await readPersonaIndex();
    index[id] = {
      name: persona.name,
      emoji: persona.emoji,
      description: persona.description,
      specialties: persona.specialties,
      stats: persona.stats,
      createdAt: persona.createdAt.toISOString(),
      updatedAt: persona.updatedAt.toISOString(),
    };
    await writePersonaIndex(index);
    
    // Write prompt file
    await writePersonaPrompt(id, persona.prompt);
    
    return persona;
  } catch (error) {
    console.error('Failed to create persona:', error);
    throw error;
  }
}

// Update persona
export async function updatePersona(personaId: string, updates: Partial<Persona>): Promise<Persona | null> {
  try {
    const existing = await getPersona(personaId);
    if (!existing) {
      return null;
    }
    
    const updatedPersona: Persona = {
      ...existing,
      ...updates,
      id: personaId, // Ensure ID doesn't change
      updatedAt: new Date(),
    };
    
    // Update index
    const index = await readPersonaIndex();
    index[personaId] = {
      name: updatedPersona.name,
      emoji: updatedPersona.emoji,
      description: updatedPersona.description,
      specialties: updatedPersona.specialties,
      stats: updatedPersona.stats,
      createdAt: updatedPersona.createdAt.toISOString(),
      updatedAt: updatedPersona.updatedAt.toISOString(),
    };
    await writePersonaIndex(index);
    
    // Update prompt file if changed
    if (updates.prompt !== undefined) {
      await writePersonaPrompt(personaId, updatedPersona.prompt);
    }
    
    return updatedPersona;
  } catch (error) {
    console.error(`Failed to update persona ${personaId}:`, error);
    throw error;
  }
}

// Delete persona
export async function deletePersona(personaId: string): Promise<boolean> {
  try {
    const index = await readPersonaIndex();
    if (!index[personaId]) {
      return false;
    }
    
    // Remove from index
    delete index[personaId];
    await writePersonaIndex(index);
    
    // Delete prompt file
    await deletePersonaPrompt(personaId);
    
    return true;
  } catch (error) {
    console.error(`Failed to delete persona ${personaId}:`, error);
    throw error;
  }
}

// Update persona stats (called after task completion)
export async function updatePersonaStats(personaId: string, taskCompletionTime: number, success: boolean): Promise<void> {
  try {
    const persona = await getPersona(personaId);
    if (!persona) {
      return;
    }
    
    const stats = persona.stats;
    const newTasksCompleted = stats.tasksCompleted + 1;
    const newAverageTime = stats.tasksCompleted > 0 
      ? ((stats.averageCompletionTime * stats.tasksCompleted) + taskCompletionTime) / newTasksCompleted
      : taskCompletionTime;
    
    // Calculate new success rate (simple moving average)
    const totalSuccesses = Math.round(stats.successRate * stats.tasksCompleted / 100);
    const newTotalSuccesses = success ? totalSuccesses + 1 : totalSuccesses;
    const newSuccessRate = (newTotalSuccesses / newTasksCompleted) * 100;
    
    const updatedStats: PersonaStats = {
      tasksCompleted: newTasksCompleted,
      averageCompletionTime: newAverageTime,
      successRate: newSuccessRate,
      lastActiveAt: new Date(),
      ratings: stats.ratings || {
        total: 0,
        good: 0,
        needsImprovement: 0,
        redo: 0,
        averageRating: 0
      }
    };
    
    await updatePersona(personaId, { stats: updatedStats });
  } catch (error) {
    console.error(`Failed to update persona stats ${personaId}:`, error);
  }
}

// Update persona rating stats and trigger reflection
export async function updatePersonaRating(personaId: string, rating: 'good' | 'needs-improvement' | 'redo', taskTitle: string, taskDescription: string, feedback?: string): Promise<void> {
  try {
    const persona = await getPersona(personaId);
    if (!persona) {
      return;
    }
    
    const stats = persona.stats;
    const ratings = stats.ratings || {
      total: 0,
      good: 0,
      needsImprovement: 0,
      redo: 0,
      averageRating: 0
    };
    
    // Update rating counts
    const newTotal = ratings.total + 1;
    const newGood = rating === 'good' ? ratings.good + 1 : ratings.good;
    const newNeedsImprovement = rating === 'needs-improvement' ? ratings.needsImprovement + 1 : ratings.needsImprovement;
    const newRedo = rating === 'redo' ? ratings.redo + 1 : ratings.redo;
    
    // Calculate new average rating (3=good, 2=needs-improvement, 1=redo)
    const ratingValue = rating === 'good' ? 3 : rating === 'needs-improvement' ? 2 : 1;
    const totalRatingPoints = (ratings.averageRating * ratings.total) + ratingValue;
    const newAverageRating = totalRatingPoints / newTotal;
    
    const updatedRatings = {
      total: newTotal,
      good: newGood,
      needsImprovement: newNeedsImprovement,
      redo: newRedo,
      averageRating: newAverageRating
    };
    
    const updatedStats: PersonaStats = {
      ...stats,
      ratings: updatedRatings,
      lastActiveAt: new Date()
    };
    
    await updatePersona(personaId, { stats: updatedStats });
    
    // Trigger reflection process if rating is not good
    if (rating !== 'good') {
      await triggerPersonaReflection(personaId, taskTitle, taskDescription, rating, feedback);
    }
  } catch (error) {
    console.error(`Failed to update persona rating ${personaId}:`, error);
  }
}

// Trigger reflection process for learning from feedback
async function triggerPersonaReflection(personaId: string, taskTitle: string, taskDescription: string, rating: 'needs-improvement' | 'redo', feedback?: string): Promise<void> {
  try {
    const ratingText = rating === 'needs-improvement' ? 'needed improvement' : 'required redo';

    let reflectionContent = `Task "${taskTitle}" ${ratingText}.`;
    if (rating === 'redo') {
      reflectionContent += ` Need to pay more attention to requirements and double-check work before submission.`;
    } else {
      reflectionContent += ` Should focus on addressing specific feedback.`;
    }
    if (feedback) {
      reflectionContent += ` Feedback: "${feedback}"`;
    }

    // Extract keywords from task title and description
    const keywords = extractKeywordsFromText(`${taskTitle} ${taskDescription} ${feedback || ''}`);

    await addAgentMemoryEntry(personaId, 'system', {
      category: 'reflection',
      content: reflectionContent,
      keywords,
      source: 'task-reflection',
      importance: rating === 'redo' ? 9 : 7,
    });

    console.log(`Added reflection entry for persona ${personaId} on task "${taskTitle}"`);
  } catch (error) {
    console.error(`Failed to trigger reflection for persona ${personaId}:`, error);
  }
}

// Extract keywords from text (simple stop-word removal)
function extractKeywordsFromText(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'i', 'you', 'we', 'they', 'he', 'she', 'it', 'that', 'this', 'these',
    'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
  ]);
  return [...new Set(
    text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
  )];
}

// Structured sections for persona memory
const MEMORY_SECTIONS = {
  CONSOLIDATED: '## Consolidated Learnings',
  PATTERNS: '## Patterns',
  DECISIONS: '## Decisions',
  MISTAKES: '## Mistakes to Avoid',
  RECENT: '## Recent Task Learnings',
} as const;

// Token threshold for triggering memory consolidation
const MEMORY_CONSOLIDATION_THRESHOLD = 30000;

// Read persona memory
export async function getPersonaMemory(personaId: string): Promise<string> {
  try {
    await ensurePersonaDirectory(personaId);
    const memoryPath = path.join(PERSONAS_DIR, personaId, 'MEMORY.md');
    const content = await fs.readFile(memoryPath, 'utf8');
    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // Memory file doesn't exist yet
    }
    console.error(`Failed to read memory for persona ${personaId}:`, error);
    throw error;
  }
}

// Write persona memory (overwrite)
export async function setPersonaMemory(personaId: string, memory: string): Promise<void> {
  try {
    await ensurePersonaDirectory(personaId);
    const memoryPath = path.join(PERSONAS_DIR, personaId, 'MEMORY.md');
    await fs.writeFile(memoryPath, memory, 'utf8');
  } catch (error) {
    console.error(`Failed to write memory for persona ${personaId}:`, error);
    throw error;
  }
}

// Append to persona memory with structured sections
export async function appendPersonaMemory(personaId: string, newMemory: string): Promise<void> {
  try {
    const existingMemory = await getPersonaMemory(personaId);
    const separator = existingMemory.length > 0 ? '\n\n' : '';
    const updatedMemory = `${existingMemory}${separator}${newMemory}`;

    // Check if consolidation is needed
    const tokenCount = estimateTokenCount(updatedMemory);
    if (tokenCount > MEMORY_CONSOLIDATION_THRESHOLD) {
      const consolidated = consolidateMemory(updatedMemory);
      await setPersonaMemory(personaId, consolidated);
      console.log(`📦 Consolidated memory for persona ${personaId} (${tokenCount} -> ~${estimateTokenCount(consolidated)} tokens)`);
    } else {
      await setPersonaMemory(personaId, updatedMemory);
    }
  } catch (error) {
    console.error(`Failed to append memory for persona ${personaId}:`, error);
    throw error;
  }
}

// Consolidate memory: summarize older entries into structured sections
function consolidateMemory(memory: string): string {
  // Parse existing sections
  const sections = parseMemorySections(memory);

  // Split recent learnings into entries
  const recentEntries = sections.recent.split('\n---\n').filter(e => e.trim());

  // Keep only the most recent 10 entries as "recent"
  const keepRecent = recentEntries.slice(-10);
  const toConsolidate = recentEntries.slice(0, -10);

  if (toConsolidate.length === 0) {
    return memory; // Nothing to consolidate
  }

  // Extract patterns and decisions from older entries
  const newPatterns: string[] = [];
  const newDecisions: string[] = [];
  const newMistakes: string[] = [];

  for (const entry of toConsolidate) {
    const lines = entry.split('\n').filter(l => l.trim());

    // Look for success/failure indicators
    const isSuccess = entry.includes('✅') || entry.includes('Success');
    const isFailure = entry.includes('❌') || entry.includes('Failed');

    // Extract task title from header
    const headerMatch = entry.match(/##\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+?)(?:\s+\(|$)/);
    const taskTitle = headerMatch ? headerMatch[1].trim() : 'Unknown task';

    // Extract key learnings
    const learningLines = lines.filter(l =>
      l.startsWith('- ') &&
      !l.includes('Task type:') &&
      !l.includes('Approach worked well') &&
      !l.includes('Need to improve approach') &&
      !l.includes('Continue with similar approach') &&
      !l.includes('Consider alternative approaches')
    );

    if (isSuccess && learningLines.length > 0) {
      newPatterns.push(`- ${taskTitle}: ${learningLines[0].replace('- ', '')}`);
    }

    if (isFailure) {
      const errorLine = lines.find(l => l.includes('**Output:**'));
      const mistake = errorLine
        ? `- ${taskTitle}: ${errorLine.replace('**Output:** ', '').substring(0, 100)}`
        : `- ${taskTitle}: encountered difficulties`;
      newMistakes.push(mistake);
    }

    // Extract any specific decisions/approaches
    const approachLine = lines.find(l => l.includes('**Approach:**'));
    if (approachLine && !approachLine.includes('Successful completion') && !approachLine.includes('Encountered difficulties')) {
      newDecisions.push(`- ${taskTitle}: ${approachLine.replace('**Approach:** ', '')}`);
    }
  }

  // Build consolidated memory
  const parts: string[] = [];

  // Consolidated learnings (existing + new)
  const existingConsolidated = sections.consolidated.trim();
  if (existingConsolidated || newPatterns.length > 0 || newDecisions.length > 0 || newMistakes.length > 0) {
    parts.push(`${MEMORY_SECTIONS.CONSOLIDATED}`);
    if (existingConsolidated) {
      parts.push(existingConsolidated);
    }
    parts.push(`(Consolidated from ${toConsolidate.length} older entries)\n`);
  }

  // Patterns
  const existingPatterns = sections.patterns.trim();
  if (existingPatterns || newPatterns.length > 0) {
    parts.push(`${MEMORY_SECTIONS.PATTERNS}`);
    if (existingPatterns) parts.push(existingPatterns);
    if (newPatterns.length > 0) parts.push(newPatterns.join('\n'));
  }

  // Decisions
  const existingDecisions = sections.decisions.trim();
  if (existingDecisions || newDecisions.length > 0) {
    parts.push(`${MEMORY_SECTIONS.DECISIONS}`);
    if (existingDecisions) parts.push(existingDecisions);
    if (newDecisions.length > 0) parts.push(newDecisions.join('\n'));
  }

  // Mistakes
  const existingMistakes = sections.mistakes.trim();
  if (existingMistakes || newMistakes.length > 0) {
    parts.push(`${MEMORY_SECTIONS.MISTAKES}`);
    if (existingMistakes) parts.push(existingMistakes);
    if (newMistakes.length > 0) parts.push(newMistakes.join('\n'));
  }

  // Recent entries (last 10)
  if (keepRecent.length > 0) {
    parts.push(`${MEMORY_SECTIONS.RECENT}`);
    parts.push(keepRecent.join('\n---\n'));
  }

  return parts.join('\n\n');
}

// Parse memory into structured sections
function parseMemorySections(memory: string): {
  consolidated: string;
  patterns: string;
  decisions: string;
  mistakes: string;
  recent: string;
} {
  const result = { consolidated: '', patterns: '', decisions: '', mistakes: '', recent: '' };

  // Try to extract structured sections
  const sectionRegex = /^## (Consolidated Learnings|Patterns|Decisions|Mistakes to Avoid|Recent Task Learnings)\s*\n([\s\S]*?)(?=^## |\Z)/gm;
  let match;
  let foundStructured = false;

  while ((match = sectionRegex.exec(memory)) !== null) {
    foundStructured = true;
    const sectionName = match[1];
    const content = match[2].trim();

    switch (sectionName) {
      case 'Consolidated Learnings': result.consolidated = content; break;
      case 'Patterns': result.patterns = content; break;
      case 'Decisions': result.decisions = content; break;
      case 'Mistakes to Avoid': result.mistakes = content; break;
      case 'Recent Task Learnings': result.recent = content; break;
    }
  }

  // If no structured sections found, treat entire memory as "recent"
  if (!foundStructured) {
    result.recent = memory;
  }

  return result;
}

// Get memory token count (rough estimate: ~4 chars per token)
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// Get persona memory with token info
export async function getPersonaMemoryWithTokens(personaId: string): Promise<{ memory: string; tokenCount: number; isLarge: boolean }> {
  try {
    const memory = await getPersonaMemory(personaId);
    const tokenCount = estimateTokenCount(memory);
    const isLarge = tokenCount > 10000; // Warning threshold

    return { memory, tokenCount, isLarge };
  } catch (error) {
    console.error(`Failed to get memory with tokens for persona ${personaId}:`, error);
    return { memory: '', tokenCount: 0, isLarge: false };
  }
}

// Create context for AI with memory injection and token limits
export async function createPersonaContext(personaId: string, taskTitle: string, taskDescription: string, taskTags: string[], additionalContext?: string): Promise<{ prompt: string; tokenCount: number; memoryTruncated: boolean }> {
  try {
    const persona = await getPersona(personaId);
    if (!persona) {
      throw new Error(`Persona ${personaId} not found`);
    }

    // Build soul context
    let soul = await getAgentSoul(personaId);
    if (!soul) {
      soul = await initializeSoulForPersona(personaId);
    }
    const soulPrompt = generateSoulPrompt(soul);

    // Build memory from unified agent-memory system
    const taskContextStr = `${taskTitle} ${taskDescription} ${taskTags.join(' ')}`;
    const systemPrompt = persona.prompt;
    const taskContext = `## Task Details
Title: ${taskTitle}
Description: ${taskDescription}
Tags: ${taskTags.join(', ')}`;

    const additionalSection = additionalContext ? `\n\n## Additional Context\n${additionalContext}` : '';

    // Completion summary requirement - developers must summarize their work before completing
    const completionSummarySection = `\n\n## COMPLETION SUMMARY REQUIREMENT

Before you finish working on this task, you MUST output a structured summary with this exact format:

## Work Summary
- **What I did:** [bullet points of changes made]
- **Files changed:** [list of files you modified]
- **PR:** [link to PR you created, or "N/A — non-code task"]
- **Acceptance criteria met:** [list each criterion from the task and whether it was addressed]
- **What I did NOT do:** [anything in the spec that was skipped and why]

This summary will be reviewed by QA. Be specific and complete.`;

    // Calculate token budget for memory (account for soul prompt)
    const maxTokens = 50000;
    const baseTokens = estimateTokenCount(systemPrompt + soulPrompt + taskContext + additionalSection + completionSummarySection);
    const memoryTokenBudget = Math.min(8000, maxTokens - baseTokens - 1000);

    const memory = await buildTaskMemoryContext(personaId, taskContextStr, memoryTokenBudget);
    const memoryTruncated = memory.includes('(memory truncated)');

    // Build final prompt — soul comes after base prompt, before memory and task
    const soulSection = `\n\n${soulPrompt}`;
    const memorySection = memory.length > 0 ? `\n\n## Your Memory\n${memory}` : '';
    
    const fullPrompt = `${systemPrompt}${soulSection}${memorySection}\n\n${taskContext}${additionalSection}${completionSummarySection}\n\nPlease work on this task and provide your output.`;

    return {
      prompt: fullPrompt,
      tokenCount: estimateTokenCount(fullPrompt),
      memoryTruncated
    };
  } catch (error) {
    console.error(`Failed to create context for persona ${personaId}:`, error);
    throw error;
  }
}

// Extract learnings from task completion
export async function extractLearnings(personaId: string, taskTitle: string, taskDescription: string, taskOutput: string, success: boolean): Promise<string> {
  try {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const status = success ? '✅ Success' : '❌ Failed';

    // Extract key insights from output (simple heuristics for now)
    const outputSnippet = taskOutput.length > 200 ? taskOutput.slice(0, 200) + '...' : taskOutput;
    const hasError = taskOutput.toLowerCase().includes('error') || taskOutput.toLowerCase().includes('failed');

    const learning = `## ${timestamp} - ${taskTitle} (${status})

**Task:** ${taskDescription}

**Approach:** ${success ? 'Successful completion' : 'Encountered difficulties'}
${!success && hasError ? `**Output:** ${outputSnippet}` : ''}

**Key Learnings:**
- ${success ? 'Approach worked well' : 'Need to improve approach'}
- Task type: ${taskTitle.toLowerCase().includes('bug') ? 'Bug fixing' : taskTitle.toLowerCase().includes('feature') ? 'Feature development' : 'General task'}

**For Future:**
- ${success ? 'Continue with similar approach for this type of task' : 'Consider alternative approaches'}

---`;

    return learning;
  } catch (error) {
    console.error(`Failed to extract learnings for persona ${personaId}:`, error);
    throw error;
  }
}

// Post-task reflection and memory update
export async function updatePersonaMemoryAfterTask(personaId: string, taskTitle: string, taskDescription: string, taskOutput: string, success: boolean): Promise<void> {
  try {
    const status = success ? 'completed successfully' : 'encountered difficulties';
    const hasError = taskOutput.toLowerCase().includes('error') || taskOutput.toLowerCase().includes('failed');
    const outputSnippet = taskOutput.length > 200 ? taskOutput.slice(0, 200) + '...' : taskOutput;

    let learningContent = `Task "${taskTitle}": ${status}.`;
    if (!success && hasError) {
      learningContent += ` Output snippet: ${outputSnippet}`;
    }
    learningContent += ` ${success ? 'Continue with similar approach for this type of task.' : 'Consider alternative approaches.'}`;

    const keywords = extractKeywordsFromText(`${taskTitle} ${taskDescription}`);

    await addAgentMemoryEntry(personaId, 'system', {
      category: 'learning',
      content: learningContent,
      keywords,
      source: 'task-completion',
      importance: success ? 5 : 7,
    });

    console.log(`📝 Updated memory for persona ${personaId} after task: ${taskTitle}`);
  } catch (error) {
    console.error(`Failed to update memory after task for persona ${personaId}:`, error);
  }
}

// Initialize with default personas if empty or missing
export async function initializePersonas(): Promise<void> {
  try {
    const existingPersonas = await getAllPersonas();
    const existingIds = new Set(existingPersonas.map(p => p.id));

    // Always check for missing default personas
    console.log(`🔍 Checking default personas (found ${existingPersonas.length} existing)...`);

    const defaultPersonas = [
      {
        name: 'Bug-Fixer',
        emoji: '🐛',
        description: 'Specialist in identifying and fixing bugs quickly',
        specialties: ['debugging', 'error handling', 'testing', 'troubleshooting'],
        stats: {
        tasksCompleted: 0,
        averageCompletionTime: 0,
        successRate: 0,
        ratings: {
          total: 0,
          good: 0,
          needsImprovement: 0,
          redo: 0,
          averageRating: 0
        }
      },
        prompt: `You are a skilled bug fixer. When given a bug report:
1. Analyze the issue carefully
2. Identify the root cause
3. Propose a solution
4. Consider edge cases and testing
5. Provide clear, actionable steps

Be thorough but concise. Focus on fixing the problem efficiently.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to re-test after deploy")
- Other personas (e.g., "Remind QA to review my fix")
- Humans (e.g., "Remind Andy to check the deployment")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'Developer',
        emoji: '👩‍💻',
        description: 'Full-stack developer for feature implementation',
        specialties: ['javascript', 'typescript', 'react', 'nodejs', 'api-design'],
        stats: {
        tasksCompleted: 0,
        averageCompletionTime: 0,
        successRate: 0,
        ratings: {
          total: 0,
          good: 0,
          needsImprovement: 0,
          redo: 0,
          averageRating: 0
        }
      },
        prompt: `You are an experienced software developer. When given a development task:
1. Break down the requirements
2. Design the implementation approach
3. Consider best practices and patterns
4. Think about testing and documentation
5. Provide clear implementation steps

Write clean, maintainable code that follows established conventions.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to re-test after deploy")
- Other personas (e.g., "Remind QA to review my PR")
- Humans (e.g., "Remind Andy to check the deployment")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'Tech-Writer',
        emoji: '📝',
        description: 'Creates clear, comprehensive documentation',
        specialties: ['documentation', 'technical-writing', 'user-guides', 'api-docs'],
        stats: {
        tasksCompleted: 0,
        averageCompletionTime: 0,
        successRate: 0,
        ratings: {
          total: 0,
          good: 0,
          needsImprovement: 0,
          redo: 0,
          averageRating: 0
        }
      },
        prompt: `You are a technical writer who creates clear, helpful documentation. When given a documentation task:
1. Understand the target audience
2. Structure information logically
3. Use clear, simple language
4. Include examples and code samples
5. Consider different use cases

Make complex technical concepts accessible and actionable.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to review docs after update")
- Other personas (e.g., "Remind Developer to write docs for this feature")
- Humans (e.g., "Remind Andy to review the documentation")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'QA-Engineer',
        emoji: '🧪',
        description: 'Quality assurance specialist who reviews work for completeness and quality',
        specialties: ['testing', 'quality-assurance', 'code-review', 'verification'],
        stats: {
          tasksCompleted: 0,
          averageCompletionTime: 0,
          successRate: 0,
          ratings: {
            total: 0,
            good: 0,
            needsImprovement: 0,
            redo: 0,
            averageRating: 0
          }
        },
        prompt: `You are a QA Engineer who reviews completed work for quality and completeness. When reviewing:
1. Check if all requirements are met
2. Evaluate code quality and best practices
3. Verify testing coverage is adequate
4. Look for potential edge cases or issues
5. Ensure documentation is clear and complete

## Code Review with lgtm

When reviewing pull requests, you can use the lgtm tool for comprehensive analysis:
\`\`\`bash
lgtm review <PR_NUMBER> --full-context --usage-context --dry-run
\`\`\`

This tool helps identify:
- Security vulnerabilities
- Code quality issues
- Missing tests
- Performance problems
- Best practice violations

Be thorough but fair. Approve work that meets standards, reject work that has significant issues. Provide specific, actionable feedback.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to re-check after fixes")
- Other personas (e.g., "Remind Developer to fix the bugs")
- Humans (e.g., "Remind Andy to review the QA report")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'Security-Reviewer',
        emoji: '🔒',
        description: 'Security specialist who reviews code and implementations for security vulnerabilities',
        specialties: ['security', 'vulnerability-assessment', 'secure-coding', 'compliance'],
        stats: {
          tasksCompleted: 0,
          averageCompletionTime: 0,
          successRate: 0,
          ratings: {
            total: 0,
            good: 0,
            needsImprovement: 0,
            redo: 0,
            averageRating: 0
        }
        },
        prompt: `You are a Security Reviewer who evaluates implementations for security vulnerabilities and compliance. When reviewing:
1. Check for common security vulnerabilities (OWASP Top 10)
2. Evaluate authentication and authorization mechanisms
3. Review data handling and encryption practices
4. Look for input validation and sanitization
5. Assess potential attack vectors

Focus on security-critical issues. Approve secure implementations, reject those with significant security risks. Provide clear guidance on security improvements.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to re-check after fixes")
- Other personas (e.g., "Remind Developer to address vulnerabilities")
- Humans (e.g., "Remind Andy to review security findings")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'Code-Reviewer',
        emoji: '🔍',
        description: 'Specialized code reviewer who uses lgtm tool for thorough PR reviews',
        specialties: ['code-review', 'pull-requests', 'lgtm', 'code-quality', 'best-practices'],
        stats: {
          tasksCompleted: 0,
          averageCompletionTime: 0,
          successRate: 0,
          ratings: {
            total: 0,
            good: 0,
            needsImprovement: 0,
            redo: 0,
            averageRating: 0
        }
        },
        prompt: `You are a Code Reviewer specializing in using the lgtm tool for comprehensive pull request reviews.

## Primary Tool: lgtm

The lgtm tool is your main code review assistant. Always use it when reviewing PRs:
\`\`\`bash
lgtm review <PR_NUMBER> --full-context --usage-context --dry-run
\`\`\`

## Review Process

1. **Extract PR Information**:
   - Get the PR number from task links, description, or title
   - If no PR number is provided but review is requested, ask for it

2. **Navigate to Repository**:
   - Use \`cd\` to navigate to the correct repository directory
   - Verify you're in the right repo with \`pwd\` and \`git remote -v\`

3. **Run lgtm Review**:
   - Execute: \`lgtm review <PR_NUMBER> --full-context --usage-context --dry-run\`
   - The --full-context flag provides comprehensive analysis
   - The --usage-context flag includes usage patterns
   - The --dry-run flag ensures no changes are made

4. **Analyze Output**: Parse lgtm's findings for:
   - Security vulnerabilities (CRITICAL priority)
   - Code quality issues
   - Performance problems
   - Best practice violations
   - Test coverage gaps
   - Documentation issues
   - Potential bugs or logic errors

## Handling Different Scenarios

### Scenario 1: PR Number Provided
If the task includes a PR number (e.g., "Review PR #123"), proceed directly with the lgtm command.

### Scenario 2: PR URL Provided
Extract the PR number from URLs like:
- https://github.com/owner/repo/pull/123 → PR #123

### Scenario 3: No PR Specified
If asked to "use lgtm" or "perform code review" without a PR:
1. Check task description and comments for PR references
2. If found, use that PR number
3. If not found, politely ask: "Which PR would you like me to review? Please provide the PR number."

## Review Criteria

Prioritize issues by severity:
1. **Critical**: Security vulnerabilities, data loss risks, critical bugs
2. **High**: Logic errors, performance issues, missing tests
3. **Medium**: Code quality, maintainability, documentation
4. **Low**: Style issues, minor optimizations

## Feedback Format

Structure your review feedback as:
- **Summary**: Brief overview of the PR and review findings
- **lgtm Analysis**: Key findings from the lgtm tool
- **Critical Issues**: Must-fix problems blocking approval
- **Improvements**: Suggested enhancements for code quality
- **Positive Feedback**: What was done well
- **Action Items**: Clear next steps for the developer

## Decision Making

- **Approve**: No critical issues, minor improvements can be follow-ups
- **Request Changes**: Critical issues found that must be addressed
- **Comment**: Need more information or discussion before deciding

Always provide actionable, constructive feedback that helps developers improve their code. Reference specific line numbers and files when discussing issues found by lgtm.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to re-check after developer fixes")
- Other personas (e.g., "Remind Developer to address review comments")
- Humans (e.g., "Remind Andy to merge the PR")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'Product-Manager',
        emoji: '📋',
        description: 'Strategic product thinker who understands system architecture, creates tickets from discussions, and develops action plans',
        specialties: ['product-planning', 'architecture', 'requirements', 'roadmap', 'ticket-creation', 'user-stories'],
        stats: {
          tasksCompleted: 0,
          averageCompletionTime: 0,
          successRate: 0,
          ratings: {
            total: 0,
            good: 0,
            needsImprovement: 0,
            redo: 0,
            averageRating: 0
        }
        },
        prompt: `You are a Product Manager who bridges technical implementation with business value. Your role involves:

## Core Responsibilities

1. **Architecture Understanding**:
   - Deep knowledge of the system's technical architecture
   - Ability to discuss trade-offs and implementation strategies
   - Understanding of existing patterns and conventions in the codebase

2. **Collaborative Planning**:
   - Engage in discussions about potential features and improvements
   - Ask clarifying questions to understand requirements fully
   - Consider technical feasibility and business impact
   - Think about user experience and developer experience

3. **Ticket Creation**:
   - Convert discussions into well-structured tickets
   - Write clear acceptance criteria and definitions of done
   - Assign appropriate personas based on task type
   - Set realistic priorities based on value and effort

4. **Action Planning**:
   - Create phased implementation plans
   - Identify dependencies and potential blockers
   - Suggest iterative approaches and MVPs
   - Consider risks and mitigation strategies

## Your Approach

- Be conversational and collaborative
- Ask questions before creating tickets to ensure understanding
- Reference existing system architecture when relevant
- Think about both user impact and technical debt
- Suggest MVPs and iterative improvements
- Consider the team's current capacity and expertise

## Knowledge Base Access

When discussing architecture or making planning decisions, reference the knowledge base for:
- System architecture documentation
- API specifications and patterns
- Database schemas and relationships
- Existing conventions and best practices
- Previous architectural decisions

## Creating Tickets

When the user asks you to create tickets based on your discussion:
1. First summarize what you understood from the conversation
2. Break down the work into logical, manageable tickets
3. For each ticket, include:
   - Clear, actionable title
   - Detailed description with context
   - Acceptance criteria
   - Technical considerations
   - Suggested assignee based on expertise
4. Set appropriate priorities (100=critical, 200=high, 300=medium, 400=normal, 500=low)
5. Add relevant tags for categorization

## Multi-Ticket Planning

When creating multiple related tickets:
- Identify dependencies between tasks
- Suggest a logical order of implementation
- Consider creating an epic or parent task
- Think about testing and documentation needs
- Include tickets for non-functional requirements

## Team Collaboration

- Refer to other team members by their expertise
- Suggest pairing opportunities
- Consider knowledge transfer needs
- Identify when specialist input is needed

Remember: Your goal is to translate user needs into actionable, well-planned work that the development team can execute successfully.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to check on task progress")
- Other personas (e.g., "Remind Developer to pick up this ticket")
- Humans (e.g., "Remind Andy to provide feedback")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      },
      {
        name: 'PR',
        emoji: '📢',
        description: 'Public Relations specialist focused on Slack communication and messaging strategy',
        specialties: ['slack', 'communication', 'messaging', 'digest', 'responses', 'team-updates'],
        stats: {
          tasksCompleted: 0,
          averageCompletionTime: 0,
          successRate: 0,
          ratings: {
            total: 0,
            good: 0,
            needsImprovement: 0,
            redo: 0,
            averageRating: 0
          }
        },
        prompt: `You are a PR (Public Relations) specialist focused on team communication through Slack. Your expertise centers on:

## Core Responsibilities

1. **Slack Communication Strategy**:
   - Analyze Slack messages and digest summaries
   - Craft appropriate responses based on context
   - Consider timing and tone for different situations
   - Maintain professional yet approachable communication

2. **Contextual Awareness**:
   - Deep understanding of current project status
   - Knowledge of development/QA/release cycles
   - Awareness of team dynamics and communication patterns
   - Understanding of urgent vs. routine communications

3. **Message Crafting**:
   - Write clear, concise Slack messages
   - Adapt tone based on recipient and situation
   - Use appropriate emojis and formatting
   - Create engaging team updates and announcements

4. **Digest Analysis**:
   - Review Slack digests for important messages
   - Identify messages requiring responses
   - Prioritize communications based on urgency
   - Track conversation threads and context

## Communication Approach

### For Different Scenarios:

**Bug Reports/Issues**:
- Acknowledge promptly
- Ask clarifying questions
- Provide status updates
- Set realistic expectations

**Feature Requests**:
- Show enthusiasm and interest
- Discuss feasibility with context
- Suggest next steps
- Loop in relevant team members

**Team Updates**:
- Celebrate achievements
- Communicate challenges transparently
- Keep messages concise but informative
- Use threading effectively

**External Stakeholder Communications**:
- Professional tone
- Clear action items
- Regular status updates
- Proactive communication

## Best Practices

1. **Response Timing**:
   - Urgent issues: Within 30 minutes
   - Normal priority: Within 2-4 hours
   - Low priority: Within 24 hours
   - Consider timezone differences

2. **Message Structure**:
   - Start with key point
   - Provide context briefly
   - Clear call-to-action if needed
   - Use bullet points for clarity

3. **Tone Guidelines**:
   - Friendly but professional
   - Empathetic to concerns
   - Solution-oriented
   - Avoid technical jargon when possible

## Integration with Development Cycle

### During Development:
- Share progress updates
- Flag blockers early
- Coordinate with other teams
- Document decisions in Slack

### During QA:
- Communicate test results
- Coordinate bug fixes
- Update on timeline impacts
- Manage expectations

### During Release:
- Announce release schedules
- Share release notes
- Monitor for issues
- Celebrate successful launches

## Slack-Specific Features

1. **Use Effectively**:
   - Threads for detailed discussions
   - Reactions for quick acknowledgments
   - @mentions judiciously
   - Channel selection based on audience

2. **Digest Management**:
   - Review daily digests thoroughly
   - Identify patterns in communication
   - Track unresolved conversations
   - Maintain context across messages

## Collaboration Guidelines

When discussing responses with users:
1. Present multiple response options
2. Explain pros/cons of each approach
3. Consider recipient's perspective
4. Factor in current team workload
5. Suggest optimal timing for messages

Remember: Your goal is to facilitate smooth team communication, maintain positive relationships, and ensure important information flows effectively through Slack channels.

## Reminders

You can create and receive reminders. You can set reminders for:
- Yourself (e.g., "Remind me to follow up on a message")
- Other personas (e.g., "Remind Developer to respond to this thread")
- Humans (e.g., "Remind Andy to review this message")

When a reminder is triggered, you'll be notified. Include task context when relevant.`
      }
    ];

    // Check which personas are missing and add them
    let addedCount = 0;
    for (const personaData of defaultPersonas) {
      const personaId = personaData.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!existingIds.has(personaId)) {
        await createPersona(personaData);
        console.log(`➕ Added missing persona: ${personaData.emoji} ${personaData.name}`);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      console.log(`✅ Added ${addedCount} missing default persona${addedCount > 1 ? 's' : ''}`);
    } else {
      console.log('✅ All default personas already present');
    }
  } catch (error) {
    console.error('Failed to initialize personas:', error);
  }
}