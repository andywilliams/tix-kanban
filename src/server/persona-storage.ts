import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Persona, PersonaStats } from '../client/types/index.js';

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
    };
    
    await updatePersona(personaId, { stats: updatedStats });
  } catch (error) {
    console.error(`Failed to update persona stats ${personaId}:`, error);
  }
}

// Initialize with default personas if empty
export async function initializePersonas(): Promise<void> {
  try {
    const personas = await getAllPersonas();
    if (personas.length === 0) {
      console.log('🔄 Creating default personas...');
      
      const defaultPersonas = [
        {
          name: 'Bug Fixer',
          emoji: '🐛',
          description: 'Specialist in identifying and fixing bugs quickly',
          specialties: ['debugging', 'error handling', 'testing', 'troubleshooting'],
          stats: { tasksCompleted: 0, averageCompletionTime: 0, successRate: 0 },
          prompt: `You are a skilled bug fixer. When given a bug report:
1. Analyze the issue carefully
2. Identify the root cause
3. Propose a solution
4. Consider edge cases and testing
5. Provide clear, actionable steps

Be thorough but concise. Focus on fixing the problem efficiently.`
        },
        {
          name: 'Developer',
          emoji: '👩‍💻',
          description: 'Full-stack developer for feature implementation',
          specialties: ['javascript', 'typescript', 'react', 'nodejs', 'api-design'],
          stats: { tasksCompleted: 0, averageCompletionTime: 0, successRate: 0 },
          prompt: `You are an experienced software developer. When given a development task:
1. Break down the requirements
2. Design the implementation approach
3. Consider best practices and patterns
4. Think about testing and documentation
5. Provide clear implementation steps

Write clean, maintainable code that follows established conventions.`
        },
        {
          name: 'Tech Writer',
          emoji: '📝',
          description: 'Creates clear, comprehensive documentation',
          specialties: ['documentation', 'technical-writing', 'user-guides', 'api-docs'],
          stats: { tasksCompleted: 0, averageCompletionTime: 0, successRate: 0 },
          prompt: `You are a technical writer who creates clear, helpful documentation. When given a documentation task:
1. Understand the target audience
2. Structure information logically
3. Use clear, simple language
4. Include examples and code samples
5. Consider different use cases

Make complex technical concepts accessible and actionable.`
        }
      ];
      
      for (const personaData of defaultPersonas) {
        await createPersona(personaData);
      }
      
      console.log('✅ Default personas created');
    }
  } catch (error) {
    console.error('Failed to initialize personas:', error);
  }
}