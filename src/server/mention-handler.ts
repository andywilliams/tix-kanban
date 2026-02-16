import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
  getAllPersonas
} from './persona-storage.js';
import { 
  addMessage, 
  getMessages 
} from './chat-storage.js';
import { ChatMessage, Persona } from '../client/types/index.js';

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
    
    // Get recent chat history for context (last 10 messages)
    const recentMessages = await getMessages(originalMessage.channelId, 10);
    
    // Create context prompt for the persona
    const contextPrompt = createChatContextPrompt(persona, originalMessage, recentMessages);
    
    // Create temporary file with the prompt
    const tempPromptFile = path.join(os.tmpdir(), `tix-mention-${persona.id}-${Date.now()}.txt`);
    await fs.writeFile(tempPromptFile, contextPrompt, 'utf8');
    
    // Use Claude CLI with --print mode (no session persistence)
    const { stdout, stderr } = await execAsync(
      `cat "${tempPromptFile}" | claude --print`,
      { maxBuffer: 1024 * 1024, timeout: 60000 } // 1MB buffer, 60s timeout
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
      
      console.log(`✅ Persona ${persona.name} responded in channel ${originalMessage.channelId}`);
    } else {
      console.log(`⚠️  Persona ${persona.name} generated empty response`);
    }
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
  }
}

// Create context prompt for chat responses
function createChatContextPrompt(persona: Persona, originalMessage: ChatMessage, recentMessages: ChatMessage[]): string {
  // Format recent chat history
  const chatHistory = recentMessages
    .slice(-10) // Last 10 messages
    .map(msg => {
      const author = msg.authorType === 'persona' ? `${msg.author} (AI)` : msg.author;
      const timestamp = new Date(msg.createdAt).toLocaleTimeString();
      return `[${timestamp}] ${author}: ${msg.content}`;
    })
    .join('\n');
  
  // Extract persona memory if available (simplified - just use the prompt for now)
  const memory = persona.prompt || '';
  
  return `You are ${persona.name} ${persona.emoji}, an AI persona in a team chat system.

## Your Identity:
${persona.description}

## Your Core Instructions:
${memory}

## Specialties:
${persona.specialties.join(', ') || 'General assistance'}

## Chat Context:
You were mentioned in this team chat. Here's the recent conversation:

${chatHistory}

## Current Message:
The user just said: "${originalMessage.content}"

## Instructions:
- Respond naturally and helpfully as ${persona.name}
- Be conversational and contextual to the chat thread
- Keep responses concise but useful (1-3 sentences typically)
- Don't repeat information already in the chat
- Be helpful and engaging
- If asked a technical question, use your specialties
- Don't respond with meta-commentary about being an AI unless directly asked

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