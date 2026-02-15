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
    const persona = await getPersona(personaId);
    if (!persona) {
      return;
    }
    
    // Create reflection entry for memory
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const ratingText = rating === 'needs-improvement' ? 'needed improvement' : 'required redo';
    
    let reflectionEntry = `## ${timestamp} - Reflection: Task "${taskTitle}"\n\n`;
    reflectionEntry += `**Task:** ${taskTitle}\n`;
    reflectionEntry += `**Rating:** ${ratingText}\n`;
    
    if (feedback) {
      reflectionEntry += `**Feedback:** ${feedback}\n`;
    }
    
    reflectionEntry += `**Description:** ${taskDescription}\n\n`;
    reflectionEntry += `**Lesson:** `;
    
    if (rating === 'redo') {
      reflectionEntry += `This task required a complete redo. I need to pay more attention to the requirements and double-check my work before submission.`;
    } else {
      reflectionEntry += `This task needed improvement. I should focus on addressing the specific feedback provided.`;
    }
    
    if (feedback) {
      reflectionEntry += ` Specific feedback to address: "${feedback}"`;
    }
    
    reflectionEntry += `\n\n**Action:** Apply these lessons to future similar tasks to improve quality and avoid similar issues.`;
    
    // Append to persona memory
    await appendPersonaMemory(personaId, reflectionEntry);
    
    console.log(`Added reflection entry for persona ${personaId} on task "${taskTitle}"`);
  } catch (error) {
    console.error(`Failed to trigger reflection for persona ${personaId}:`, error);
  }
}

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

// Append to persona memory
export async function appendPersonaMemory(personaId: string, newMemory: string): Promise<void> {
  try {
    const existingMemory = await getPersonaMemory(personaId);
    const separator = existingMemory.length > 0 ? '\n\n' : '';
    const updatedMemory = `${existingMemory}${separator}${newMemory}`;
    await setPersonaMemory(personaId, updatedMemory);
  } catch (error) {
    console.error(`Failed to append memory for persona ${personaId}:`, error);
    throw error;
  }
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
    
    const { memory } = await getPersonaMemoryWithTokens(personaId);
    
    // Base prompt parts
    const systemPrompt = persona.prompt;
    const taskContext = `## Task Details
Title: ${taskTitle}
Description: ${taskDescription}
Tags: ${taskTags.join(', ')}`;
    
    const additionalSection = additionalContext ? `\n\n## Additional Context\n${additionalContext}` : '';
    
    // Calculate token budget (aim for ~50k total, reserve space for task content)
    const maxTokens = 50000;
    const baseTokens = estimateTokenCount(systemPrompt + taskContext + additionalSection);
    const memoryTokenBudget = maxTokens - baseTokens - 1000; // 1000 token buffer
    
    let finalMemory = memory;
    let memoryTruncated = false;
    
    if (memory.length > 0) {
      const memoryTokens = estimateTokenCount(memory);
      if (memoryTokens > memoryTokenBudget) {
        // Truncate memory from the beginning, keeping recent learnings
        const targetChars = memoryTokenBudget * 4;
        const truncatePoint = memory.length - targetChars;
        if (truncatePoint > 0) {
          // Try to truncate at a natural break (paragraph)
          const paragraphBreak = memory.indexOf('\n\n', truncatePoint);
          const actualTruncatePoint = paragraphBreak > 0 ? paragraphBreak + 2 : truncatePoint;
          finalMemory = '...(earlier memories truncated)...\n\n' + memory.slice(actualTruncatePoint);
          memoryTruncated = true;
        }
      }
    }
    
    // Build final prompt
    const memorySection = finalMemory.length > 0 ? `\n\n## Your Memory\n${finalMemory}` : '';
    const fullPrompt = `${systemPrompt}${memorySection}\n\n${taskContext}${additionalSection}\n\nPlease work on this task and provide your output.`;
    
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
    // This would ideally use an AI service to reflect on the task
    // For now, create a simple structured learning entry
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
    const learning = await extractLearnings(personaId, taskTitle, taskDescription, taskOutput, success);
    await appendPersonaMemory(personaId, learning);
    
    console.log(`📝 Updated memory for persona ${personaId} after task: ${taskTitle}`);
  } catch (error) {
    console.error(`Failed to update memory after task for persona ${personaId}:`, error);
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

Be thorough but concise. Focus on fixing the problem efficiently.`
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

Write clean, maintainable code that follows established conventions.`
        },
        {
          name: 'Tech Writer',
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

Make complex technical concepts accessible and actionable.`
        },
        {
          name: 'QA Engineer',
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

Be thorough but fair. Approve work that meets standards, reject work that has significant issues. Provide specific, actionable feedback.`
        },
        {
          name: 'Security Reviewer',
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

Focus on security-critical issues. Approve secure implementations, reject those with significant security risks. Provide clear guidance on security improvements.`
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