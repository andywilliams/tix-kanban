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
import { getAllTasks } from './storage.js';
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
    
    // Get recent tickets for this persona
    const allTasks = await getAllTasks();
    const personaTasks = allTasks
      .filter(t => t.assignee === persona.id || t.assignee === persona.name)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8);
    const taskContext = personaTasks.length > 0
      ? personaTasks.map(t => `- [${t.status}] ${t.title}${t.priority ? ` (P${t.priority})` : ''}`).join('\n')
      : 'No tasks currently assigned.';
    
    // Create the full prompt
    const prompt = buildChatPrompt({
      soul,
      persona,
      originalMessage,
      recentMessages,
      memoryContext,
      relevantMemories,
      teamContext,
      taskContext
    });
    
    // Generate response using AI
    const response = await generateAIResponse(prompt, persona);
    
    if (response && response.length > 0) {
      // Post the response
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        response,
        originalMessage.id
      );
      
      // Check if response contains learning we should remember
      await extractAndStoreInferredMemory(persona.id, userId, originalMessage.content, response);
      
      console.log(`✅ ${persona.name} responded in channel ${originalMessage.channelId}`);
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
  taskContext: string;
}): string {
  const { soul, persona, originalMessage, recentMessages, memoryContext, relevantMemories, teamContext, taskContext } = context;
  
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
  
  // Current workload
  sections.push(`\n## Your Current Tasks\n${taskContext}`);
  
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

Generate your response now:`);
  
  return sections.join('\n');
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
