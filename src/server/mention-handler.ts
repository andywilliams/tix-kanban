import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
  getAllPersonas
} from './persona-storage.js';
import { getTask } from './storage.js';
import { 
  addMessage, 
  getMessages,
  ChatMessage,
  acquireSpeakingTurn,
  releaseSpeakingTurn,
  getChannel,
  getChannelSummary
} from './chat-storage.js';
import { Persona } from '../client/types/index.js';
import {
  processRememberCommand,
  generateMemoryContext,
  getPersonaSoul,
  generateDefaultSoul,
  savePersonaSoul,
  addMemoryEntry,
} from './persona-memory.js';
import {
  calculatePersonaMood,
  getMoodPromptAddition,
} from './persona-mood.js';

const execAsync = promisify(exec);

// Process @mentions in a chat message
export async function processMentions(message: ChatMessage): Promise<void> {
  if (message.mentions.length === 0) {
    return;
  }
  
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
  
  // Process each mentioned persona independently
  for (const persona of mentionedPersonas) {
    // Don't await - let multiple personas respond in parallel
    generatePersonaResponse(message, persona).catch(error => {
      console.error(`Failed to generate response for persona ${persona.name}:`, error);
    });
  }
}

// Generate and post a response from a persona
async function generatePersonaResponse(originalMessage: ChatMessage, persona: Persona): Promise<void> {
  try {
    console.log(`🤖 Generating response for persona: ${persona.name} (${persona.emoji})`);
    
    // Try to acquire speaking turn (implements turn-taking)
    const acquired = await acquireSpeakingTurn(originalMessage.channelId, persona.id);
    if (!acquired) {
      console.log(`🚫 ${persona.name} cannot respond - another persona is speaking`);
      return;
    }
    
    // Check for "remember" commands first
    const rememberResult = await processRememberCommand(
      persona.id,
      originalMessage.content,
      originalMessage.author
    );
    
    if (rememberResult.processed && rememberResult.response) {
      // Just post the acknowledgment
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        rememberResult.response,
        originalMessage.id
      );
      console.log(`📝 Persona ${persona.name} processed memory command`);
      // Release turn after posting
      await releaseSpeakingTurn(originalMessage.channelId, persona.id);
      return;
    }
    
    // Get recent chat history for context (last 10 messages)
    const recentMessages = await getMessages(originalMessage.channelId, 10);
    
    // Get or create soul for personality
    let soul = await getPersonaSoul(persona.id);
    if (!soul) {
      console.log(`✨ Generating default soul for ${persona.name}`);
      soul = await generateDefaultSoul(persona);
      await savePersonaSoul(soul);
    }
    
    // Create context prompt for the persona with memory
    const contextPrompt = await createChatContextPrompt(persona, soul, originalMessage, recentMessages);
    
    // Create temporary file with the prompt
    const tempPromptFile = path.join(os.tmpdir(), `tix-mention-${persona.id}-${Date.now()}.txt`);
    await fs.writeFile(tempPromptFile, contextPrompt, 'utf8');
    
    // Use Claude CLI in agentic mode for mention responses (using stdin to avoid shell injection)
    const { stdout, stderr } = await execAsync(
      `cat "${tempPromptFile}" | claude -p --allowedTools Read,web_search`,
      { maxBuffer: 1024 * 1024, timeout: 70000 } // 1MB buffer, 70s timeout (process-level timeout)
    );
    
    // Clean up temp file
    await fs.unlink(tempPromptFile).catch(() => {});
    
    if (stderr) {
      console.error(`Persona ${persona.name} stderr:`, stderr);
    }
    
    const response = stdout.trim();
    
    if (response && response.length > 0) {
      // Post the AI response back to the channel
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        response,
        originalMessage.id // Reply to the original message
      );
      
      // Log interaction to memory
      await addMemoryEntry(
        persona.id,
        'context',
        `Conversation with ${originalMessage.author}: "${originalMessage.content.slice(0, 100)}..."`,
        'self',
        { importance: 'low' }
      );
      
      console.log(`✅ Persona ${persona.name} responded in channel ${originalMessage.channelId}`);
    } else {
      console.log(`⚠️  Persona ${persona.name} generated empty response`);
    }
    
    // Release speaking turn
    await releaseSpeakingTurn(originalMessage.channelId, persona.id);
  } catch (error) {
    console.error(`❌ Failed to generate persona response for ${persona.name}:`, error);
    
    // Post an error message as the persona (for debugging)
    try {
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        `Sorry, I encountered an error while processing your message. ${error instanceof Error ? error.message : 'Unknown error'}`,
        originalMessage.id
      );
    } catch (postError) {
      console.error(`Failed to post error message for persona ${persona.name}:`, postError);
    }
    
    // Always release turn, even on error
    await releaseSpeakingTurn(originalMessage.channelId, persona.id);
  }
}

// Create context prompt for chat responses with personality and memory
async function createChatContextPrompt(
  persona: Persona,
  soul: any,
  originalMessage: ChatMessage,
  recentMessages: ChatMessage[]
): Promise<string> {
  // Get channel to check if this is a task conversation
  const channel = await getChannel(originalMessage.channelId);
  let taskContext = '';
  
  // If this is a task channel, include task information
  if (channel && channel.type === 'task' && channel.taskId) {
    const task = await getTask(channel.taskId);
    if (task) {
      taskContext = `## Task Context

**Task ID:** ${task.id}
**Title:** ${task.title}
**Status:** ${task.status}
**Description:**
${task.description}

${task.tags && task.tags.length > 0 ? `**Tags:** ${task.tags.join(', ')}` : ''}
${task.assignee ? `**Assigned to:** ${task.assignee}` : ''}

This conversation is about the task described above. Keep your responses relevant to this context.

`;
    }
  }
  
  // Get conversation summary for older messages (if available)
  let conversationSummary = '';
  if (channel) {
    const summary = await getChannelSummary(originalMessage.channelId);
    if (summary) {
      conversationSummary = `## Earlier Conversation Summary:\n${summary}\n\n`;
    }
  }
  
  // Format recent chat history (last 5 messages for task channels, 10 for others)
  const messageLimit = channel?.type === 'task' ? 5 : 10;
  const chatHistory = recentMessages
    .slice(-messageLimit)
    .map(msg => {
      const author = msg.authorType === 'persona' ? `${msg.author} (AI)` : msg.author;
      const timestamp = new Date(msg.createdAt).toLocaleTimeString();
      return `[${timestamp}] ${author}: ${msg.content}`;
    })
    .join('\n');
  
  // Get memory context
  const memoryContext = await generateMemoryContext(
    persona.id,
    originalMessage.content,
    1500
  );
  
  // Calculate current mood
  const mood = await calculatePersonaMood(persona);
  const moodSection = getMoodPromptAddition(mood);
  
  // Build personality section from soul
  let personalitySection = '';
  if (soul) {
    personalitySection = `## Your Personality: ${soul.archetype}

**Communication style:** ${soul.traits.communication}
**Approach:** ${soul.traits.approach}

${soul.voicePatterns.length > 0 ? `**Voice:** ${soul.voicePatterns.join('; ')}` : ''}
${soul.catchphrases.length > 0 ? `**Catchphrases you might use:** "${soul.catchphrases.join('", "')}"` : ''}
${soul.values.length > 0 ? `**What you care about:** ${soul.values.join(', ')}` : ''}
${soul.dislikes.length > 0 ? `**Things you dislike:** ${soul.dislikes.join(', ')}` : ''}
${moodSection}
`;
  }
  
  return `You are ${persona.name} ${persona.emoji}, an AI persona in a team chat system.

## Your Identity:
${persona.description}

${personalitySection}

## Your Core Instructions:
${persona.prompt || 'Be helpful and professional.'}

## Specialties:
${persona.specialties.join(', ') || 'General assistance'}

${memoryContext}

${taskContext}${conversationSummary}## Recent Chat History:
${chatHistory}

## Current Message:
The user "${originalMessage.author}" just said: "${originalMessage.content}"

## Instructions:
- Respond naturally and helpfully as ${persona.name}
- Be conversational and contextual to the chat thread
- Keep responses concise but useful (1-3 sentences typically, unless more detail is needed)
- Don't repeat information already in the chat
- Stay in character with your personality
- If they ask you to remember something, acknowledge it warmly
- Reference your memories when relevant
- Be genuinely helpful, not performatively helpful
${taskContext ? '- Keep your response relevant to the task at hand' : ''}
- You can address other personas by @name if you need their input

Generate your response now:`;
}

// Extract personas mentioned in text content
export function extractPersonaMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return [...new Set(mentions)]; // Remove duplicates
}

// Check if a persona should respond to a message
export async function shouldPersonaRespond(persona: Persona, message: ChatMessage): Promise<boolean> {
  // Don't respond to other personas to avoid loops
  if (message.authorType === 'persona') {
    return false;
  }
  
  // Check if this persona is mentioned
  const mentioned = message.mentions.some(mention => 
    mention.toLowerCase() === persona.name.toLowerCase() ||
    mention.toLowerCase() === persona.id.toLowerCase()
  );
  
  return mentioned;
}

// Get team awareness context for a persona
export async function getTeamContext(personaId: string): Promise<string> {
  const personas = await getAllPersonas();
  const currentPersona = personas.find(p => p.id === personaId);
  
  if (!currentPersona) return '';
  
  const otherPersonas = personas.filter(p => p.id !== personaId);
  
  let context = `## Your Team\n\n`;
  context += `You work alongside these AI teammates:\n\n`;
  
  for (const p of otherPersonas) {
    context += `- **${p.emoji} ${p.name}**: ${p.description}. Specialties: ${p.specialties.join(', ')}\n`;
  }
  
  context += `\nYou can refer to your teammates naturally when their expertise is relevant.\n`;
  
  return context;
}
