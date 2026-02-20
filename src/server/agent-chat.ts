/**
 * Agent Chat System
 * 
 * Handles conversations with personas, including:
 * - Memory-aware responses
 * - Soul-infused personalities
 * - Remember commands
 * - Team interactions
 */

import { 
  getAgentMemory,
  addMemoryEntry,
  parseRememberCommand,
  buildMemoryContext,
  recordInteraction,
  searchMemories
} from './agent-memory.js';
import {
  getAgentSoul,
  generateSoulPrompt,
  getGreeting,
  getAcknowledgment,
  initializeSoulForPersona,
  AgentSoul
} from './agent-soul.js';
import { getAllPersonas, getPersona } from './persona-storage.js';
import { addMessage, getMessages, ChatMessage } from './chat-storage.js';
import { getAllTasks, createTask } from './storage.js';
import { getGitHubConfig, getRepoPRs } from './github.js';
import { Persona } from '../client/types/index.js';


export interface ChatContext {
  channelId: string;
  userId: string;
  message: ChatMessage;
  recentMessages: ChatMessage[];
  task?: {
    id: string;
    title: string;
    description: string;
  };
}

// Process @mentions in a chat message
export async function processChatMention(message: ChatMessage): Promise<void> {
  if (message.mentions.length === 0) return;
  
  console.log(`💬 Processing mentions: ${message.mentions.join(', ')} in channel ${message.channelId}`);
  
  // Prevent infinite loops - don't respond to persona messages
  if (message.authorType === 'persona') {
    console.log('🚫 Skipping mention processing for persona message');
    return;
  }
  
  // Get all available personas
  const personas = await getAllPersonas();
  
  // Find mentioned personas (case insensitive matching)
  const mentionedPersonas = personas.filter(persona => 
    message.mentions.some(mention => 
      mention.toLowerCase() === persona.name.toLowerCase() ||
      mention.toLowerCase() === persona.id.toLowerCase()
    )
  );
  
  if (mentionedPersonas.length === 0) {
    console.log('🔍 No matching personas found for mentions');
    return;
  }
  
  // Check for "remember" command
  const rememberCmd = parseRememberCommand(message.content);
  
  // Process each mentioned persona
  for (const persona of mentionedPersonas) {
    // Handle remember command
    if (rememberCmd) {
      await handleRememberCommand(persona, message, rememberCmd);
      continue;
    }
    
    // Generate contextual response
    generatePersonaResponse(message, persona).catch(error => {
      console.error(`Failed to generate response for persona ${persona.name}:`, error);
    });
  }
}

// Handle a "remember" command
async function handleRememberCommand(
  persona: Persona,
  message: ChatMessage,
  rememberCmd: ReturnType<typeof parseRememberCommand>
): Promise<void> {
  if (!rememberCmd) return;
  
  try {
    const userId = message.author; // Use author as user ID for now
    
    // Add to memory
    await addMemoryEntry(persona.id, userId, {
      category: rememberCmd.category,
      content: rememberCmd.content,
      keywords: rememberCmd.keywords,
      source: 'explicit',
      importance: 7 // User explicitly asked to remember, so it's important
    });
    
    // Confirm with a response
    const soul = await getAgentSoul(persona.id);
    let confirmMessage = `Got it! I'll remember that ${rememberCmd.content}`;
    
    if (soul) {
      confirmMessage = `${getAcknowledgment(soul)} I'll remember: "${rememberCmd.content}" `;
      
      switch (rememberCmd.category) {
        case 'preferences':
          confirmMessage += '(saved to your preferences)';
          break;
        case 'instructions':
          confirmMessage += "(I'll follow this going forward)";
          break;
        case 'context':
          confirmMessage += '(saved as context)';
          break;
        case 'relationships':
          confirmMessage += "(noted for our working relationship)";
          break;
      }
    }
    
    await addMessage(
      message.channelId,
      persona.name,
      'persona',
      confirmMessage,
      message.id
    );
    
    console.log(`📝 ${persona.name} remembered: "${rememberCmd.content}" (${rememberCmd.category})`);
  } catch (error) {
    console.error(`Failed to process remember command for ${persona.name}:`, error);
    
    await addMessage(
      message.channelId,
      persona.name,
      'persona',
      "Sorry, I had trouble remembering that. Could you try again?",
      message.id
    );
  }
}

// Generate and post a response from a persona
async function generatePersonaResponse(
  originalMessage: ChatMessage, 
  persona: Persona
): Promise<void> {
  try {
    console.log(`🤖 Generating response for persona: ${persona.name} (${persona.emoji})`);
    
    const userId = originalMessage.author;
    
    // Record the interaction
    await recordInteraction(persona.id, userId);
    
    // Get or initialize soul
    let soul = await getAgentSoul(persona.id);
    if (!soul) {
      soul = await initializeSoulForPersona(persona.id);
    }
    
    // Get recent chat history
    const recentMessages = await getMessages(originalMessage.channelId, 15);
    
    // Build memory context
    const memoryContext = await buildMemoryContext(
      persona.id, 
      userId, 
      originalMessage.content
    );
    
    // Search for relevant memories
    const relevantMemories = await searchMemories(
      persona.id,
      userId,
      originalMessage.content,
      { limit: 3 }
    );
    
    // Get other personas for team awareness
    const allPersonas = await getAllPersonas();
    const teamContext = allPersonas
      .filter(p => p.id !== persona.id)
      .map(p => `${p.emoji} ${p.name}: ${p.description}`)
      .join('\n');
    
    // Get ALL board tasks grouped by status
    const allTasks = await getAllTasks();
    const tasksByStatus: Record<string, typeof allTasks> = {};
    for (const t of allTasks) {
      if (!tasksByStatus[t.status]) tasksByStatus[t.status] = [];
      tasksByStatus[t.status].push(t);
    }
    
    const boardContext = Object.entries(tasksByStatus)
      .map(([status, tasks]) => {
        const taskLines = tasks
          .sort((a, b) => (a.priority || 500) - (b.priority || 500))
          .map(t => `  - ${t.title} (ID: ${t.id})${t.assignee ? ` [${t.assignee}]` : ''}${t.priority ? ` P${t.priority}` : ''}${t.repo ? ` repo:${t.repo}` : ''}`)
          .join('\n');
        return `**${status}** (${tasks.length}):\n${taskLines}`;
      })
      .join('\n');
    
    // Get open PRs from configured repos (non-blocking — skip if GitHub not configured)
    let prContext = 'GitHub not configured or no repos set up.';
    try {
      const ghConfig = await getGitHubConfig();
      if (ghConfig.repos.length > 0) {
        const prLines: string[] = [];
        for (const repo of ghConfig.repos.slice(0, 5)) { // Limit to 5 repos
          const repoName = typeof repo === 'string' ? repo : repo.name;
          try {
            const prs = await getRepoPRs(repoName, 'open');
            if (prs.length > 0) {
              prLines.push(`**${repoName}:**`);
              for (const pr of prs.slice(0, 10)) { // Limit to 10 PRs per repo
                prLines.push(`  - #${pr.number}: ${pr.title} (${pr.state})${pr.author ? ` by ${pr.author}` : ''}`);
              }
            }
          } catch { /* skip repos that fail */ }
        }
        if (prLines.length > 0) {
          prContext = prLines.join('\n');
        } else {
          prContext = 'No open PRs found.';
        }
      }
    } catch {
      // GitHub not available — that's fine
    }
    
    // Create the full prompt
    const prompt = buildChatPrompt({
      soul,
      persona,
      originalMessage,
      recentMessages,
      memoryContext,
      relevantMemories,
      teamContext,
      boardContext,
      prContext
    });
    
    // Generate response using AI
    const response = await generateAIResponse(prompt, persona);
    
    if (response && response.length > 0) {
      // Parse and execute any actions from the response
      const { cleanResponse, actions } = parseResponseActions(response);
      
      // Post the conversational part of the response
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        cleanResponse,
        originalMessage.id
      );
      
      // Execute any actions (task creation, etc.)
      for (const action of actions) {
        try {
          const result = await executeAction(action, persona, originalMessage.channelId);
          if (result) {
            // Post confirmation message
            await addMessage(
              originalMessage.channelId,
              persona.name,
              'persona',
              result
            );
          }
        } catch (actionErr) {
          console.error(`Action failed:`, actionErr);
          await addMessage(
            originalMessage.channelId,
            persona.name,
            'persona',
            `⚠️ I tried to create that ticket but hit an error: ${actionErr instanceof Error ? actionErr.message : 'Unknown error'}`
          );
        }
      }
      
      // Check if response contains learning we should remember
      await extractAndStoreInferredMemory(persona.id, userId, originalMessage.content, cleanResponse);
      
      console.log(`✅ ${persona.name} responded in channel ${originalMessage.channelId}${actions.length > 0 ? ` (${actions.length} actions executed)` : ''}`);
    } else {
      console.log(`⚠️ ${persona.name} generated empty response`);
    }
  } catch (error) {
    console.error(`❌ Failed to generate persona response for ${persona.name}:`, error);
    
    // Post error message
    try {
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        `Sorry, I ran into a problem processing your message. ${error instanceof Error ? error.message : ''}`,
        originalMessage.id
      );
    } catch {}
  }
}

// Build the full chat prompt
function buildChatPrompt(context: {
  soul: AgentSoul;
  persona: Persona;
  originalMessage: ChatMessage;
  recentMessages: ChatMessage[];
  memoryContext: string;
  relevantMemories: any[];
  teamContext: string;
  boardContext: string;
  prContext: string;
}): string {
  const { soul, persona, originalMessage, recentMessages, memoryContext, relevantMemories, teamContext, boardContext, prContext } = context;
  
  const sections: string[] = [];
  
  // Soul prompt (personality)
  sections.push(generateSoulPrompt(soul));
  
  // Original persona prompt (if different)
  if (persona.prompt && persona.prompt.length > 0) {
    sections.push(`\n## Additional Instructions\n${persona.prompt}`);
  }
  
  // Memory context
  if (memoryContext) {
    sections.push(`\n## What You Remember About This User\n${memoryContext}`);
  }
  
  // Relevant memories for this query
  if (relevantMemories.length > 0) {
    const memoryList = relevantMemories
      .map(m => `- [${m.category}] ${m.content}`)
      .join('\n');
    sections.push(`\n## Relevant Memories\n${memoryList}`);
  }
  
  // Team awareness
  sections.push(`\n## Your Team\nYou work with these other personas:\n${teamContext}\n\nYou can refer to them naturally in conversation (e.g., "You might also want to ask @Developer about...")`);
  
  // Kanban board state
  sections.push(`\n## Kanban Board (All Tasks)\n${boardContext}`);
  
  // Open PRs
  sections.push(`\n## Open Pull Requests\n${prContext}`);
  
  // Chat history
  const chatHistory = recentMessages
    .slice(-10)
    .map(msg => {
      const author = msg.authorType === 'persona' ? `${msg.author} (AI)` : msg.author;
      return `${author}: ${msg.content}`;
    })
    .join('\n');
  
  sections.push(`\n## Recent Chat History\n${chatHistory}`);
  
  // Current message
  sections.push(`\n## Current Message\n${originalMessage.author}: ${originalMessage.content}`);
  
  // Instructions
  sections.push(`\n## Your Response
Respond naturally as ${persona.name}. Be conversational and helpful.
- Stay in character with your personality
- Reference relevant memories if appropriate
- Keep responses concise but useful (typically 1-4 sentences)
- Use your catchphrases and quirks occasionally
- If another team member would be better suited, suggest they ask them
- Don't start with "As ${persona.name}..." - just respond naturally

## Actions You Can Take
You can create tickets on the kanban board when the user asks. To create a ticket, include a JSON block in your response like this:

\`\`\`action
{"action":"create_task","title":"Short descriptive title","description":"Detailed description of what needs to be done","assignee":"persona-id","priority":400,"tags":["tag1","tag2"]}
\`\`\`

Guidelines for task creation:
- **assignee** should be the persona id (e.g. "developer", "tech-writer", "qa") — use the team list above
- **priority** is a number: 100=critical, 200=high, 300=medium, 400=normal, 500=low
- **tags** are optional labels
- Write your conversational response BEFORE the action block
- Only create a task when the user explicitly asks for one
- Confirm what you're creating in your response text

Available team members for assignment:
${teamContext}

Generate your response now:`);
  
  return sections.join('\n');
}

// Parse action blocks from AI response
interface ResponseAction {
  action: string;
  title?: string;
  description?: string;
  assignee?: string;
  priority?: number;
  tags?: string[];
  [key: string]: any;
}

function parseResponseActions(response: string): { cleanResponse: string; actions: ResponseAction[] } {
  const actions: ResponseAction[] = [];
  
  // Match ```action ... ``` blocks
  const actionBlockRegex = /```action\s*\n?([\s\S]*?)```/g;
  let match;
  
  while ((match = actionBlockRegex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.action) {
        actions.push(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse action block:', match[1]);
    }
  }
  
  // Remove action blocks from the response to get clean conversational text
  const cleanResponse = response
    .replace(/```action\s*\n?[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return { cleanResponse, actions };
}

// Execute a parsed action
async function executeAction(
  action: ResponseAction, 
  persona: Persona, 
  channelId: string
): Promise<string | null> {
  switch (action.action) {
    case 'create_task': {
      if (!action.title) {
        throw new Error('Task title is required');
      }
      
      const task = await createTask({
        title: action.title,
        description: action.description || '',
        status: 'backlog',
        priority: action.priority || 400,
        assignee: action.assignee || undefined,
        persona: action.assignee || undefined,
        tags: action.tags || [],
      }, persona.name);
      
      const assigneeText = action.assignee ? ` → assigned to **${action.assignee}**` : '';
      return `📋 **Ticket created:** ${task.title} (ID: ${task.id})${assigneeText} — Priority: P${action.priority || 400}`;
    }
    
    default:
      console.warn(`Unknown action: ${action.action}`);
      return null;
  }
}

// Generate AI response using Claude Code CLI
async function generateAIResponse(prompt: string, persona: Persona): Promise<string> {
  return new Promise(async (resolve) => {
    try {
      const { spawn } = await import('child_process');
      
      // Use spawn to pipe prompt via stdin — avoids shell escaping issues
      const claude = spawn('claude', ['-p', '-', '--max-turns', '1', '--allowedTools', 'Read'], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000
      });
      
      let stdout = '';
      let stderr = '';
      
      claude.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      claude.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      
      claude.on('close', async (code: number | null) => {
        if (stderr) {
          console.error(`Persona ${persona.name} stderr:`, stderr.substring(0, 200));
        }
        
        const response = stdout.trim();
        if (response && response.length > 0) {
          resolve(response);
          return;
        }
        
        console.warn(`Claude Code returned empty/failed (code ${code}) for ${persona.name}`);
        const soul = await getAgentSoul(persona.id);
        resolve(soul?.greetings?.[0] || `I'm ${persona.name}, how can I help?`);
      });
      
      claude.on('error', async (err: Error) => {
        console.error(`Claude Code spawn failed for ${persona.name}:`, err.message);
        const soul = await getAgentSoul(persona.id);
        resolve(soul?.greetings?.[0] || `I'm ${persona.name}, how can I help?`);
      });
      
      // Write prompt to stdin and close it
      claude.stdin.write(prompt);
      claude.stdin.end();
      
    } catch (error) {
      console.error(`Claude Code failed for ${persona.name}:`, error);
      const soul = await getAgentSoul(persona.id);
      resolve(soul?.greetings?.[0] || `I'm ${persona.name}, how can I help?`);
    }
  });
}

// Extract and store inferred memories from conversation
async function extractAndStoreInferredMemory(
  personaId: string,
  userId: string,
  userMessage: string,
  response: string
): Promise<void> {
  // Look for patterns that suggest something worth remembering
  const patterns = [
    // User preferences
    { regex: /i (?:always|usually|prefer|like to|tend to) (.+)/i, category: 'preferences' as const },
    // Project context
    { regex: /(?:our|the) project (?:is|uses|has) (.+)/i, category: 'context' as const },
    { regex: /we(?:'re| are) (?:using|building|working on) (.+)/i, category: 'context' as const },
  ];
  
  for (const { regex, category } of patterns) {
    const match = userMessage.match(regex);
    if (match) {
      const content = match[1].trim();
      if (content.length > 10 && content.length < 200) {
        try {
          await addMemoryEntry(personaId, userId, {
            category,
            content: `User mentioned: ${content}`,
            keywords: content.toLowerCase().split(/\s+/).filter(w => w.length > 3),
            source: 'inferred',
            importance: 4 // Lower importance for inferred memories
          });
          console.log(`📝 Inferred memory stored: ${content.substring(0, 50)}...`);
        } catch (error) {
          // Silently fail for inferred memories
        }
      }
    }
  }
}

// Get conversation history between a user and persona
export async function getConversationHistory(
  personaId: string,
  userId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  // Get direct chat channel for this persona-user pair
  const channelId = `direct-${personaId}-${userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return await getMessages(channelId, limit);
}

// Start a direct conversation with a persona
export async function startDirectConversation(
  personaId: string,
  userId: string
): Promise<{ channelId: string; greeting: string }> {
  const persona = await getPersona(personaId);
  if (!persona) {
    throw new Error(`Persona ${personaId} not found`);
  }
  
  const soul = await getAgentSoul(personaId);
  const greeting = soul ? getGreeting(soul) : `Hi! I'm ${persona.name}. How can I help?`;
  
  const channelId = `direct-${personaId}-${userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  return { channelId, greeting };
}

// Get team overview (for shared context)
export async function getTeamOverview(): Promise<string> {
  const personas = await getAllPersonas();
  
  const overview = personas.map(p => {
    return `**${p.emoji} ${p.name}**\n${p.description}\nSpecialties: ${p.specialties.join(', ')}`;
  }).join('\n\n');
  
  return `# Your Team\n\n${overview}`;
}

// Get relationship context for a persona
export async function getRelationshipContext(personaId: string): Promise<string> {
  const soul = await getAgentSoul(personaId);
  if (!soul || soul.relationships.length === 0) {
    return '';
  }
  
  const relationships = soul.relationships.map(r => {
    return `- ${r.personaId}: ${r.relationship} (${r.dynamicNote})`;
  }).join('\n');
  
  return `## Team Relationships\n${relationships}`;
}
