import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Persona } from '../client/types/index.js';
import { getPersona, getAllPersonas } from './persona-storage.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');

// Memory categories for structured storage
export interface MemoryEntry {
  id: string;
  category: 'preference' | 'instruction' | 'context' | 'relationship' | 'learning' | 'reflection';
  content: string;
  source: string;  // Who told them this (user name or 'self' for reflections)
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  importance: 'high' | 'medium' | 'low';
}

export interface StructuredMemory {
  version: 2;
  personaId: string;
  entries: MemoryEntry[];
  // Quick-access maps for common lookups
  preferences: { [key: string]: string };
  relationships: { [personName: string]: string };
  lastUpdated: string;
}

// Soul definition structure
export interface PersonaSoul {
  version: 1;
  personaId: string;
  // Core identity
  name: string;
  emoji: string;
  archetype: string;  // e.g., "The meticulous craftsperson", "The pragmatic problem-solver"
  // Personality traits
  traits: {
    communication: 'formal' | 'casual' | 'technical' | 'friendly' | 'direct';
    approach: 'methodical' | 'creative' | 'pragmatic' | 'thorough' | 'fast';
    style: 'verbose' | 'concise' | 'balanced';
  };
  // How they talk
  voicePatterns: string[];  // e.g., "Uses technical jargon", "Ends with action items"
  // Phrases they use
  catchphrases: string[];  // e.g., "Let me dig into that...", "Here's what I'm thinking..."
  // What they care about
  values: string[];  // e.g., "Code quality", "User experience", "Performance"
  // Pet peeves
  dislikes: string[];  // e.g., "Unclear requirements", "Magic numbers"
  // How they relate to other personas
  teamDynamics: { [personaName: string]: string };
  // Custom notes
  notes: string;
}

// Ensure persona directory exists
async function ensurePersonaDir(personaId: string): Promise<string> {
  const personaDir = path.join(PERSONAS_DIR, personaId);
  await fs.mkdir(personaDir, { recursive: true });
  return personaDir;
}

// ============================================
// STRUCTURED MEMORY SYSTEM
// ============================================

// Get structured memory for a persona
export async function getStructuredMemory(personaId: string): Promise<StructuredMemory> {
  try {
    const personaDir = await ensurePersonaDir(personaId);
    const memoryPath = path.join(personaDir, 'memory.json');
    const content = await fs.readFile(memoryPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Return empty memory structure
      return {
        version: 2,
        personaId,
        entries: [],
        preferences: {},
        relationships: {},
        lastUpdated: new Date().toISOString(),
      };
    }
    throw error;
  }
}

// Save structured memory
export async function saveStructuredMemory(memory: StructuredMemory): Promise<void> {
  const personaDir = await ensurePersonaDir(memory.personaId);
  const memoryPath = path.join(personaDir, 'memory.json');
  memory.lastUpdated = new Date().toISOString();
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2), 'utf8');
}

// Add a memory entry
export async function addMemoryEntry(
  personaId: string,
  category: MemoryEntry['category'],
  content: string,
  source: string,
  options: {
    tags?: string[];
    importance?: MemoryEntry['importance'];
  } = {}
): Promise<MemoryEntry> {
  const memory = await getStructuredMemory(personaId);
  
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    content,
    source,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: options.tags || [],
    importance: options.importance || 'medium',
  };
  
  memory.entries.push(entry);
  
  // Update quick-access maps
  if (category === 'preference') {
    const key = extractPreferenceKey(content);
    if (key) {
      memory.preferences[key] = content;
    }
  }
  if (category === 'relationship') {
    const personName = extractPersonName(content);
    if (personName) {
      memory.relationships[personName] = content;
    }
  }
  
  await saveStructuredMemory(memory);
  return entry;
}

// Search memories by query
export async function searchMemories(
  personaId: string,
  query: string,
  options: {
    category?: MemoryEntry['category'];
    limit?: number;
  } = {}
): Promise<MemoryEntry[]> {
  const memory = await getStructuredMemory(personaId);
  const queryLower = query.toLowerCase();
  
  let results = memory.entries.filter(entry => {
    if (options.category && entry.category !== options.category) {
      return false;
    }
    return entry.content.toLowerCase().includes(queryLower) ||
           entry.tags.some(tag => tag.toLowerCase().includes(queryLower));
  });
  
  // Sort by importance and recency
  results.sort((a, b) => {
    const importanceOrder = { high: 0, medium: 1, low: 2 };
    const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
    if (impDiff !== 0) return impDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  
  return options.limit ? results.slice(0, options.limit) : results;
}

// Get relevant memories for a context
export async function getRelevantMemories(
  personaId: string,
  context: string,
  limit: number = 10
): Promise<MemoryEntry[]> {
  const memory = await getStructuredMemory(personaId);
  const contextLower = context.toLowerCase();
  const contextWords = contextLower.split(/\s+/).filter(w => w.length > 3);
  
  // Score each memory by relevance
  const scored = memory.entries.map(entry => {
    let score = 0;
    const contentLower = entry.content.toLowerCase();
    
    // Direct matches
    for (const word of contextWords) {
      if (contentLower.includes(word)) {
        score += 2;
      }
    }
    
    // Tag matches
    for (const tag of entry.tags) {
      if (contextLower.includes(tag.toLowerCase())) {
        score += 3;
      }
    }
    
    // Importance boost
    score += entry.importance === 'high' ? 2 : entry.importance === 'medium' ? 1 : 0;
    
    // Recency boost (entries from last 7 days get a boost)
    const daysOld = (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 7) {
      score += 1;
    }
    
    return { entry, score };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

// ============================================
// SOUL SYSTEM
// ============================================

// Get persona soul
export async function getPersonaSoul(personaId: string): Promise<PersonaSoul | null> {
  try {
    const personaDir = await ensurePersonaDir(personaId);
    const soulPath = path.join(personaDir, 'SOUL.md');
    const content = await fs.readFile(soulPath, 'utf8');
    return parseSoulMd(content, personaId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Save persona soul
export async function savePersonaSoul(soul: PersonaSoul): Promise<void> {
  const personaDir = await ensurePersonaDir(soul.personaId);
  const soulPath = path.join(personaDir, 'SOUL.md');
  const content = formatSoulMd(soul);
  await fs.writeFile(soulPath, content, 'utf8');
}

// Generate default soul for a persona
export async function generateDefaultSoul(persona: Persona): Promise<PersonaSoul> {
  // Derive personality from specialties and description
  const specialties = persona.specialties.join(', ').toLowerCase();
  const description = persona.description.toLowerCase();
  
  // Determine communication style
  let communication: PersonaSoul['traits']['communication'] = 'balanced' as any;
  if (specialties.includes('documentation') || specialties.includes('technical-writing')) {
    communication = 'formal';
  } else if (specialties.includes('debugging') || specialties.includes('testing')) {
    communication = 'technical';
  } else if (description.includes('friendly') || description.includes('helpful')) {
    communication = 'friendly';
  }
  
  // Determine approach
  let approach: PersonaSoul['traits']['approach'] = 'pragmatic';
  if (specialties.includes('testing') || specialties.includes('security')) {
    approach = 'thorough';
  } else if (specialties.includes('debugging') || specialties.includes('troubleshooting')) {
    approach = 'methodical';
  }
  
  // Generate archetype
  const archetypes: { [key: string]: string } = {
    'debugging': 'The meticulous detective',
    'security': 'The vigilant guardian',
    'documentation': 'The clear communicator',
    'testing': 'The quality champion',
    'architecture': 'The systems thinker',
    'frontend': 'The user advocate',
    'backend': 'The infrastructure builder',
    'full-stack': 'The versatile craftsperson',
    'default': 'The helpful teammate',
  };
  
  let archetype = archetypes.default;
  for (const [key, value] of Object.entries(archetypes)) {
    if (specialties.includes(key)) {
      archetype = value;
      break;
    }
  }
  
  const soul: PersonaSoul = {
    version: 1,
    personaId: persona.id,
    name: persona.name,
    emoji: persona.emoji,
    archetype,
    traits: {
      communication,
      approach,
      style: 'balanced',
    },
    voicePatterns: [
      'Uses clear, structured explanations',
      'Provides actionable recommendations',
      'Asks clarifying questions when needed',
    ],
    catchphrases: [
      `Let me look into that...`,
      `Here's what I'm thinking:`,
      `A few things to consider:`,
    ],
    values: persona.specialties.slice(0, 3).map(s => `Quality in ${s}`),
    dislikes: [
      'Unclear requirements',
      'Skipping important steps',
    ],
    teamDynamics: {},
    notes: '',
  };
  
  return soul;
}

// ============================================
// "REMEMBER" COMMAND PROCESSING
// ============================================

// Patterns for detecting "remember" commands
const REMEMBER_PATTERNS = [
  /remember\s+(?:that\s+)?(.+)/i,
  /please\s+remember\s+(?:that\s+)?(.+)/i,
  /keep\s+in\s+mind\s+(?:that\s+)?(.+)/i,
  /note\s+(?:that\s+)?(.+)/i,
  /don'?t\s+forget\s+(?:that\s+)?(.+)/i,
  /when\s+working\s+(?:with|on)\s+.+,?\s+(.+)/i,
  /i\s+(?:prefer|like|want)\s+(.+)/i,
  /always\s+(.+)/i,
  /never\s+(.+)/i,
];

const FORGET_PATTERNS = [
  /forget\s+(?:that\s+)?(.+)/i,
  /don'?t\s+remember\s+(?:that\s+)?(.+)/i,
  /remove\s+(?:the\s+)?memory\s+(?:about\s+)?(.+)/i,
];

export interface ParsedRememberCommand {
  type: 'remember' | 'forget' | 'none';
  content: string;
  category: MemoryEntry['category'];
  importance: MemoryEntry['importance'];
}

// Parse a message for memory commands
export function parseRememberCommand(message: string): ParsedRememberCommand {
  // Check for forget commands first
  for (const pattern of FORGET_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      return {
        type: 'forget',
        content: match[1].trim(),
        category: 'instruction',
        importance: 'medium',
      };
    }
  }
  
  // Check for remember commands
  for (const pattern of REMEMBER_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const content = match[1].trim();
      
      // Determine category based on content
      let category: MemoryEntry['category'] = 'instruction';
      let importance: MemoryEntry['importance'] = 'medium';
      
      const contentLower = content.toLowerCase();
      if (contentLower.includes('prefer') || contentLower.includes('like') || contentLower.includes('want')) {
        category = 'preference';
      } else if (contentLower.includes('always') || contentLower.includes('never') || contentLower.includes('important')) {
        importance = 'high';
      } else if (contentLower.includes('when talking to') || contentLower.includes('relationship')) {
        category = 'relationship';
      }
      
      return {
        type: 'remember',
        content,
        category,
        importance,
      };
    }
  }
  
  return { type: 'none', content: '', category: 'instruction', importance: 'medium' };
}

// Process a remember command
export async function processRememberCommand(
  personaId: string,
  message: string,
  source: string
): Promise<{ processed: boolean; response?: string }> {
  const parsed = parseRememberCommand(message);
  
  if (parsed.type === 'none') {
    return { processed: false };
  }
  
  const persona = await getPersona(personaId);
  if (!persona) {
    return { processed: false };
  }
  
  if (parsed.type === 'remember') {
    // Add the memory
    await addMemoryEntry(
      personaId,
      parsed.category,
      parsed.content,
      source,
      { importance: parsed.importance }
    );
    
    // Generate acknowledgment based on personality
    const soul = await getPersonaSoul(personaId);
    const responses = soul ? [
      `Got it! I'll remember that.`,
      `Noted — I'll keep that in mind.`,
      `Thanks for letting me know. I've made a note.`,
      `I'll remember that for our future conversations.`,
    ] : [
      `I'll remember that.`,
      `Noted.`,
      `Got it.`,
    ];
    
    return {
      processed: true,
      response: responses[Math.floor(Math.random() * responses.length)] +
        (parsed.importance === 'high' ? ' This seems important, so I\'ve marked it as high priority.' : ''),
    };
  }
  
  if (parsed.type === 'forget') {
    // Find and remove matching memories
    const memory = await getStructuredMemory(personaId);
    const contentLower = parsed.content.toLowerCase();
    const originalCount = memory.entries.length;
    
    memory.entries = memory.entries.filter(entry => 
      !entry.content.toLowerCase().includes(contentLower)
    );
    
    const removedCount = originalCount - memory.entries.length;
    
    if (removedCount > 0) {
      await saveStructuredMemory(memory);
      return {
        processed: true,
        response: `I've forgotten ${removedCount} ${removedCount === 1 ? 'thing' : 'things'} about that.`,
      };
    } else {
      return {
        processed: true,
        response: `I don't have any memories about that.`,
      };
    }
  }
  
  return { processed: false };
}

// ============================================
// MEMORY CONTEXT GENERATION
// ============================================

// Generate memory context for AI prompts
export async function generateMemoryContext(
  personaId: string,
  currentContext: string,
  maxTokens: number = 2000
): Promise<string> {
  const memory = await getStructuredMemory(personaId);
  const soul = await getPersonaSoul(personaId);
  
  let context = '';
  
  // Add soul context if available
  if (soul) {
    context += `## Your Personality\n`;
    context += `Archetype: ${soul.archetype}\n`;
    context += `Communication style: ${soul.traits.communication}\n`;
    context += `Approach: ${soul.traits.approach}\n`;
    if (soul.voicePatterns.length > 0) {
      context += `Voice: ${soul.voicePatterns.slice(0, 2).join('; ')}\n`;
    }
    if (soul.values.length > 0) {
      context += `Values: ${soul.values.join(', ')}\n`;
    }
    context += '\n';
  }
  
  // Add relevant memories
  const relevantMemories = await getRelevantMemories(personaId, currentContext, 10);
  if (relevantMemories.length > 0) {
    context += `## Things You Remember\n`;
    for (const entry of relevantMemories) {
      const prefix = entry.importance === 'high' ? '⚠️ ' : '';
      context += `- ${prefix}${entry.content} (from ${entry.source})\n`;
    }
    context += '\n';
  }
  
  // Add preferences
  const prefKeys = Object.keys(memory.preferences);
  if (prefKeys.length > 0) {
    context += `## User Preferences\n`;
    for (const key of prefKeys.slice(0, 5)) {
      context += `- ${memory.preferences[key]}\n`;
    }
    context += '\n';
  }
  
  // Add relationships (how to interact with team members)
  const relationships = Object.entries(memory.relationships);
  if (relationships.length > 0) {
    context += `## Team Relationships\n`;
    for (const [person, note] of relationships.slice(0, 5)) {
      context += `- ${person}: ${note}\n`;
    }
    context += '\n';
  }
  
  // Truncate if needed
  const estimatedTokens = Math.ceil(context.length / 4);
  if (estimatedTokens > maxTokens) {
    const targetChars = maxTokens * 4;
    context = context.slice(0, targetChars) + '\n...(memory truncated)';
  }
  
  return context;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractPreferenceKey(content: string): string | null {
  const words = content.toLowerCase().split(/\s+/);
  // Use first 3 significant words as key
  const significant = words.filter(w => w.length > 3).slice(0, 3);
  return significant.length > 0 ? significant.join('-') : null;
}

function extractPersonName(content: string): string | null {
  // Simple extraction - look for capitalized words
  const match = content.match(/\b([A-Z][a-z]+)\b/);
  return match ? match[1] : null;
}

// Parse SOUL.md format
function parseSoulMd(content: string, personaId: string): PersonaSoul {
  // Simple parser for SOUL.md format
  const soul: PersonaSoul = {
    version: 1,
    personaId,
    name: '',
    emoji: '',
    archetype: '',
    traits: {
      communication: 'friendly',
      approach: 'pragmatic',
      style: 'balanced',
    },
    voicePatterns: [],
    catchphrases: [],
    values: [],
    dislikes: [],
    teamDynamics: {},
    notes: '',
  };
  
  const lines = content.split('\n');
  let currentSection = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('# ')) {
      // Name line
      soul.name = trimmed.slice(2).replace(/[^\w\s-]/g, '').trim();
      const emojiMatch = line.match(/[\u{1F300}-\u{1F9FF}]/u);
      if (emojiMatch) soul.emoji = emojiMatch[0];
    } else if (trimmed.startsWith('## ')) {
      currentSection = trimmed.slice(3).toLowerCase();
    } else if (trimmed.startsWith('- ') && currentSection) {
      const value = trimmed.slice(2);
      if (currentSection.includes('voice') || currentSection.includes('pattern')) {
        soul.voicePatterns.push(value);
      } else if (currentSection.includes('catchphrase')) {
        soul.catchphrases.push(value);
      } else if (currentSection.includes('value')) {
        soul.values.push(value);
      } else if (currentSection.includes('dislike') || currentSection.includes('pet peeve')) {
        soul.dislikes.push(value);
      }
    } else if (trimmed.startsWith('**Archetype:**')) {
      soul.archetype = trimmed.replace('**Archetype:**', '').trim();
    } else if (trimmed.startsWith('**Communication:**')) {
      const comm = trimmed.replace('**Communication:**', '').trim().toLowerCase();
      if (['formal', 'casual', 'technical', 'friendly', 'direct'].includes(comm)) {
        soul.traits.communication = comm as any;
      }
    }
  }
  
  return soul;
}

// Format soul to SOUL.md
function formatSoulMd(soul: PersonaSoul): string {
  let md = `# ${soul.emoji} ${soul.name}\n\n`;
  md += `**Archetype:** ${soul.archetype}\n\n`;
  
  md += `## Personality\n\n`;
  md += `**Communication:** ${soul.traits.communication}\n`;
  md += `**Approach:** ${soul.traits.approach}\n`;
  md += `**Style:** ${soul.traits.style}\n\n`;
  
  if (soul.voicePatterns.length > 0) {
    md += `## Voice Patterns\n\n`;
    soul.voicePatterns.forEach(p => md += `- ${p}\n`);
    md += '\n';
  }
  
  if (soul.catchphrases.length > 0) {
    md += `## Catchphrases\n\n`;
    soul.catchphrases.forEach(p => md += `- ${p}\n`);
    md += '\n';
  }
  
  if (soul.values.length > 0) {
    md += `## Values\n\n`;
    soul.values.forEach(v => md += `- ${v}\n`);
    md += '\n';
  }
  
  if (soul.dislikes.length > 0) {
    md += `## Pet Peeves\n\n`;
    soul.dislikes.forEach(d => md += `- ${d}\n`);
    md += '\n';
  }
  
  if (Object.keys(soul.teamDynamics).length > 0) {
    md += `## Team Dynamics\n\n`;
    for (const [name, dynamic] of Object.entries(soul.teamDynamics)) {
      md += `- **${name}:** ${dynamic}\n`;
    }
    md += '\n';
  }
  
  if (soul.notes) {
    md += `## Notes\n\n${soul.notes}\n`;
  }
  
  return md;
}

// Get all personas with their souls
export async function getAllPersonasWithSouls(): Promise<(Persona & { soul: PersonaSoul | null })[]> {
  const personas = await getAllPersonas();
  return Promise.all(personas.map(async (persona) => ({
    ...persona,
    soul: await getPersonaSoul(persona.id),
  })));
}
