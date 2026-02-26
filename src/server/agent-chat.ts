/**
 * Agent Chat System
 *
 * Handles conversations with personas, including:
 * - Memory-aware responses
 * - Soul-infused personalities
 * - Remember commands
 * - Team interactions
 * - Token-budgeted context building
 * - Relevance-filtered board/PR/knowledge context
 */

import {
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
import { getCachedPRs } from './pr-cache.js';
import { Persona } from '../client/types/index.js';
import { getRelevantKnowledge } from './persona-knowledge.js';
import {
  TokenTracker,
  buildBudgetedSection,
  getDefaultBudget
} from './token-budget.js';
import { getConversationBackground, maybeUpdateSummary } from './chat-summarizer.js';


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

// Common stop words to exclude from keyword matching
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'about', 'into', 'through', 'during',
  'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'that', 'this', 'these',
  'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'not', 'just', 'also', 'very', 'really', 'like', 'know', 'think',
  'want', 'need', 'help', 'work', 'make', 'take', 'come', 'look',
  'good', 'well', 'here', 'there', 'some', 'any', 'more', 'much',
  'task', 'tasks', 'done', 'doing', 'thing', 'things', 'sure', 'okay',
  'please', 'thanks', 'thank', 'right', 'yeah', 'going', 'been',
  'something', 'anything', 'everything', 'nothing', 'other', 'another',
]);

// Build relevance-filtered board context for a persona
function buildFilteredBoardContext(
  allTasks: Array<{ id: string; title: string; status: string; priority: number; assignee?: string; persona?: string; repo?: string; tags: string[] }>,
  persona: Persona,
  messageContent: string
): string {
  const messageLower = messageContent.toLowerCase();
  const messageWords = messageLower.split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  // Categorize tasks by relevance
  const relevant: typeof allTasks = [];
  const activeOther: typeof allTasks = [];
  const backgroundCounts: Record<string, number> = {};

  for (const task of allTasks) {
    const isAssignedToMe = task.assignee === persona.id || task.persona === persona.id;
    const isActive = task.status === 'in-progress' || task.status === 'review' || task.status === 'auto-review';
    // Check for explicit task ID mention, or whole-word keyword match (min 5 chars to avoid noise)
    const titleLower = task.title.toLowerCase();
    const isMentioned = messageLower.includes(task.id) ||
      messageWords.filter(w => w.length >= 5).some(w => new RegExp(`\\b${w}\\b`).test(titleLower));
    const matchesSpecialty = persona.specialties.some(s =>
      task.tags.some(t => t.toLowerCase().includes(s.toLowerCase()))
    );

    if (isAssignedToMe || isMentioned) {
      relevant.push(task);
    } else if (isActive || matchesSpecialty) {
      activeOther.push(task);
    } else {
      backgroundCounts[task.status] = (backgroundCounts[task.status] || 0) + 1;
    }
  }

  const sections: string[] = [];

  // Always show tasks relevant to this persona
  if (relevant.length > 0) {
    const lines = relevant
      .sort((a, b) => (a.priority || 500) - (b.priority || 500))
      .map(t => `  - ${t.title} (ID: ${t.id}) [${t.status}]${t.priority ? ` P${t.priority}` : ''}${t.repo ? ` repo:${t.repo}` : ''}`)
      .join('\n');
    sections.push(`**Your Tasks / Mentioned:**\n${lines}`);
  }

  // Show other active tasks (capped at 15)
  if (activeOther.length > 0) {
    const capped = activeOther
      .sort((a, b) => (a.priority || 500) - (b.priority || 500))
      .slice(0, 15);
    const lines = capped
      .map(t => `  - ${t.title} (ID: ${t.id}) [${t.status}]${t.assignee ? ` [${t.assignee}]` : ''}${t.priority ? ` P${t.priority}` : ''}`)
      .join('\n');
    const moreText = activeOther.length > 15 ? `\n  ... and ${activeOther.length - 15} more active tasks` : '';
    sections.push(`**Other Active Tasks:**\n${lines}${moreText}`);
  }

  // Summary counts for background tasks
  const bgEntries = Object.entries(backgroundCounts);
  if (bgEntries.length > 0) {
    const countLine = bgEntries.map(([status, count]) => `${status}: ${count}`).join(', ');
    sections.push(`**Other tasks:** ${countLine}`);
  }

  return sections.join('\n\n') || 'No tasks on the board.';
}

// Build relevance-filtered PR context
function buildFilteredPRContext(
  prContext: string,
  persona: Persona,
  messageContent: string
): string {
  if (!prContext || prContext.trim() === '' || prContext.includes('No cached PR data')) {
    return 'No open pull requests.';
  }

  const messageLower = messageContent.toLowerCase();
  // If message mentions PRs, code review, or similar, include full context
  const prKeywords = ['pr', 'pull request', 'review', 'merge', 'branch', 'code review'];
  const mentionsPRs = prKeywords.some(kw => messageLower.includes(kw));

  // Code Reviewer always gets full PR context
  if (mentionsPRs || persona.id === 'code-reviewer') {
    return prContext;
  }

  // For other personas, just provide a summary count
  const prLines = prContext.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'));
  if (prLines.length === 0) return prContext; // Can't parse, return as-is
  return `${prLines.length} open pull request(s). Ask @Code-Reviewer for details.`;
}

// Build selective chat history based on channel type
function buildSelectiveChatHistory(
  recentMessages: ChatMessage[],
  persona: Persona,
  originalMessage: ChatMessage,
  channelType: 'direct' | 'persona' | 'general' | 'task'
): string {
  if (recentMessages.length === 0) return 'No previous messages in this conversation.';

  const formatMessage = (msg: ChatMessage) => {
    const author = msg.authorType === 'persona' ? `${msg.author} (AI)` : msg.author;
    return `${author}: ${msg.content}`;
  };

  // For direct/persona channels: last 10 messages (simple)
  if (channelType === 'direct' || channelType === 'persona') {
    return recentMessages
      .slice(-10)
      .map(formatMessage)
      .join('\n');
  }

  // For general/task channels: last 5 for immediate context,
  // then scan further back for relevant messages
  const immediate = recentMessages.slice(-5);
  const older = recentMessages.slice(0, -5);

  // Find relevant older messages (mention this persona, or share keywords with current message)
  const messageWords = originalMessage.content.toLowerCase().split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const relevantOlder = older.filter(msg => {
    const contentLower = msg.content.toLowerCase();
    // Mentions this persona
    if (contentLower.includes(persona.name.toLowerCase()) || contentLower.includes(persona.id)) {
      return true;
    }
    // Shares meaningful keywords with current message (require 3+ matches after stop-word filtering)
    const matchCount = messageWords.filter(w => contentLower.includes(w)).length;
    return matchCount >= 3;
  });

  const parts: string[] = [];

  if (relevantOlder.length > 0) {
    parts.push('(Earlier relevant messages)');
    parts.push(...relevantOlder.slice(-5).map(formatMessage));
    parts.push('...');
  }

  parts.push(...immediate.map(formatMessage));

  return parts.join('\n');
}

// Generate and post a response from a persona
async function generatePersonaResponse(
  originalMessage: ChatMessage,
  persona: Persona
): Promise<void> {
  try {
    console.log(`🤖 Generating response for persona: ${persona.name} (${persona.emoji})`);

    const userId = originalMessage.author;
    const tracker = new TokenTracker();
    const budget = getDefaultBudget();

    // Record the interaction
    await recordInteraction(persona.id, userId);

    // Get or initialize soul
    let soul = await getAgentSoul(persona.id);
    if (!soul) {
      soul = await initializeSoulForPersona(persona.id);
    }

    // Get recent chat history — fetch more for general channels so we can filter
    const channelType = getChannelType(originalMessage.channelId);
    const fetchLimit = (channelType === 'general' || channelType === 'task') ? 30 : 15;
    let recentMessages: ChatMessage[] = [];
    try {
      recentMessages = await getMessages(originalMessage.channelId, fetchLimit);
    } catch (error) {
      console.warn(`Failed to fetch chat history: ${error}`);
    }

    // Build memory context (with error resilience)
    let memoryContext = '';
    try {
      memoryContext = await buildMemoryContext(
        persona.id,
        userId,
        originalMessage.content
      );
    } catch (error) {
      console.warn(`Failed to build memory context for ${persona.name}: ${error}`);
    }

    // Search for relevant memories (with error resilience)
    let relevantMemories: any[] = [];
    try {
      relevantMemories = await searchMemories(
        persona.id,
        userId,
        originalMessage.content,
        { limit: 3 }
      );
    } catch (error) {
      console.warn(`Failed to search memories for ${persona.name}: ${error}`);
    }

    // Get other personas for team awareness
    let teamContext = '';
    try {
      const allPersonas = await getAllPersonas();
      teamContext = allPersonas
        .filter(p => p.id !== persona.id)
        .map(p => `${p.emoji} ${p.name}: ${p.description}`)
        .join('\n');
    } catch (error) {
      console.warn(`Failed to get team context: ${error}`);
    }

    // Get relevance-filtered board context
    let boardContext = '';
    try {
      const allTasks = await getAllTasks();
      boardContext = buildFilteredBoardContext(allTasks, persona, originalMessage.content);
    } catch (error) {
      console.warn(`Failed to build board context: ${error}`);
      boardContext = 'Board state unavailable.';
    }

    // Get relevance-filtered PR context
    let prContext = '';
    try {
      const rawPRs = await getCachedPRs();
      prContext = buildFilteredPRContext(rawPRs, persona, originalMessage.content);
    } catch (error) {
      console.warn(`Failed to get PR context: ${error}`);
      prContext = 'PR data unavailable.';
    }

    // Get conversation background summary (for long conversations)
    let conversationBackground = '';
    try {
      conversationBackground = await getConversationBackground(originalMessage.channelId);
    } catch (error) {
      console.warn(`Failed to get conversation background: ${error}`);
    }

    // Get relevant knowledge for ALL personas (query-driven, not persona-gated)
    let knowledgeContext = '';
    try {
      const { summary } = await getRelevantKnowledge(
        persona,
        originalMessage.content,
        undefined,
        5
      );
      knowledgeContext = summary;
    } catch (error) {
      console.warn(`Failed to get knowledge context: ${error}`);
    }

    // Build selective chat history
    const chatHistory = buildSelectiveChatHistory(
      recentMessages, persona, originalMessage, channelType
    );

    // Create the full prompt with token budgets
    const prompt = buildChatPrompt({
      soul,
      persona,
      originalMessage,
      chatHistory,
      conversationBackground,
      memoryContext,
      relevantMemories,
      teamContext,
      boardContext,
      prContext,
      knowledgeContext,
      tracker,
      budget
    });

    console.log(`📊 ${persona.name} prompt: ${tracker.getSummary()}`);

    // Generate response using AI (with retry on failure)
    const response = await generateAIResponseWithRetry(prompt, persona, {
      soul,
      persona,
      originalMessage,
      chatHistory: recentMessages.slice(-5).map(m => `${m.author}: ${m.content}`).join('\n'),
      conversationBackground: '', // Strip background on retry
      memoryContext,
      relevantMemories,
      teamContext,
      boardContext: '', // Strip board on retry
      prContext: '', // Strip PRs on retry
      knowledgeContext: '', // Strip knowledge on retry
      tracker: new TokenTracker(),
      budget
    });

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

      // Trigger summary update for long conversations (async, non-blocking)
      maybeUpdateSummary(originalMessage.channelId).catch(() => {});

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

// Infer channel type from channel ID
function getChannelType(channelId: string): 'direct' | 'persona' | 'general' | 'task' {
  if (channelId.startsWith('direct-')) return 'direct';
  if (channelId.startsWith('persona-')) return 'persona';
  if (channelId.startsWith('task-')) return 'task';
  return 'general';
}

// Build the full chat prompt with token budget enforcement
interface PromptContext {
  soul: AgentSoul;
  persona: Persona;
  originalMessage: ChatMessage;
  chatHistory: string;
  conversationBackground: string;
  memoryContext: string;
  relevantMemories: any[];
  teamContext: string;
  boardContext: string;
  prContext: string;
  knowledgeContext?: string;
  tracker: TokenTracker;
  budget: ReturnType<typeof getDefaultBudget>;
}

function buildChatPrompt(context: PromptContext): string {
  const { soul, persona, originalMessage, chatHistory, conversationBackground, memoryContext, relevantMemories, teamContext, boardContext, prContext, knowledgeContext, tracker, budget } = context;

  const sections: string[] = [];

  // Soul prompt (personality)
  const soulText = generateSoulPrompt(soul);
  sections.push(tracker.record('soul', buildBudgetedSection('Soul', soulText, budget.soul)));

  // Original persona prompt (if different)
  if (persona.prompt && persona.prompt.length > 0) {
    sections.push(tracker.record('personaPrompt', buildBudgetedSection(
      'Persona Prompt',
      `\n## Additional Instructions\n${persona.prompt}`,
      budget.personaPrompt
    )));
  }

  // Memory context
  if (memoryContext) {
    sections.push(tracker.record('memory', buildBudgetedSection(
      'Memory',
      `\n## What You Remember About This User\n${memoryContext}`,
      budget.memory
    )));
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

  // Knowledge base context (if available and relevant)
  if (knowledgeContext) {
    sections.push(tracker.record('knowledge', buildBudgetedSection(
      'Knowledge',
      `\n${knowledgeContext}`,
      budget.knowledge
    )));
  }

  // Kanban board state (filtered)
  sections.push(tracker.record('board', buildBudgetedSection(
    'Board',
    `\n## Kanban Board\n${boardContext}`,
    budget.board
  )));

  // Open PRs (filtered)
  sections.push(tracker.record('prs', buildBudgetedSection(
    'PRs',
    `\n## Open Pull Requests\n${prContext}`,
    budget.prs
  )));

  // Conversation background summary (for long conversations)
  if (conversationBackground) {
    sections.push(`\n${conversationBackground}`);
  }

  // Chat history (selective)
  sections.push(tracker.record('chatHistory', buildBudgetedSection(
    'Chat History',
    `\n## Recent Chat History\n${chatHistory}`,
    budget.chatHistory
  )));

  // Current message
  sections.push(`\n## Current Message\n${originalMessage.author}: ${originalMessage.content}`);

  // Instructions
  const instructionsText = buildResponseInstructions(persona, teamContext);
  sections.push(tracker.record('instructions', buildBudgetedSection(
    'Instructions',
    instructionsText,
    budget.instructions
  )));

  return sections.filter(s => s.length > 0).join('\n');
}

// Build response instructions (extracted for clarity)
function buildResponseInstructions(persona: Persona, teamContext: string): string {
  let instructions = `\n## Your Response
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
- Confirm what you're creating in your response text`;

  if (persona.id === 'product-manager') {
    instructions += `

## Special Actions for Product Manager

You have additional capabilities as a Product Manager:

1. **Creating Multiple Related Tickets**: You can create several tickets at once by including multiple action blocks
2. **Detailed Descriptions**: Include acceptance criteria, technical considerations, and dependencies in descriptions
3. **Strategic Planning**: When creating tickets, think about:
   - Logical order of implementation
   - Dependencies between tasks
   - Which personas are best suited for each task
   - Realistic time estimates
   - Risk factors

Example of creating multiple tickets:
\`\`\`action
{"action":"create_task","title":"Design API endpoints","description":"Design REST API endpoints for user management\\n\\nAcceptance Criteria:\\n- Define endpoint structure\\n- Document request/response formats\\n- Consider authentication requirements","assignee":"developer","priority":300,"tags":["api","design"]}
\`\`\`

\`\`\`action
{"action":"create_task","title":"Implement user API","description":"Implement the user management API endpoints\\n\\nDependencies:\\n- API design must be complete\\n\\nTechnical Notes:\\n- Use existing auth middleware\\n- Follow RESTful conventions","assignee":"developer","priority":300,"tags":["api","backend"]}
\`\`\``;
  }

  instructions += `

Available team members for assignment:
${teamContext}

Generate your response now:`;

  return instructions;
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
  _channelId: string
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

// Check if a response looks like a valid AI reply (not an error or empty junk)
function isValidResponse(response: string): boolean {
  if (!response || response.trim().length === 0) return false;
  // Short responses are fine if they're real words (e.g. "Sure!", "Done.", "Yes")
  const trimmed = response.trim();
  if (trimmed.length > 0 && trimmed.length <= 20) {
    // Accept short responses that contain at least one letter
    return /[a-zA-Z]/.test(trimmed);
  }
  return true;
}

// Generate AI response with retry on failure
async function generateAIResponseWithRetry(
  prompt: string,
  persona: Persona,
  retryContext: PromptContext
): Promise<string> {
  const startTime = Date.now();
  const response = await generateAIResponse(prompt, persona, 90000);
  const elapsed = Date.now() - startTime;
  console.log(`⏱️ ${persona.name} AI response took ${elapsed}ms`);

  // If we got a valid response, return it
  if (isValidResponse(response)) {
    return response;
  }

  // Retry with simplified prompt
  console.log(`🔄 Retrying ${persona.name} with simplified prompt...`);
  const simplifiedPrompt = buildChatPrompt(retryContext);
  const retryResponse = await generateAIResponse(simplifiedPrompt, persona, 90000);

  if (isValidResponse(retryResponse)) {
    return retryResponse;
  }

  // Both attempts failed — return a greeting fallback
  console.warn(`⚠️ Both attempts failed for ${persona.name}, using fallback`);
  const soul = await getAgentSoul(persona.id);
  return soul?.greetings?.[0] || `I'm ${persona.name}, how can I help?`;
}

// Generate AI response using Claude Code CLI
// Returns '' on failure so the retry logic can detect it and try again.
async function generateAIResponse(prompt: string, persona: Persona, timeoutMs: number = 90000): Promise<string> {
  return new Promise(async (resolve) => {
    try {
      const { spawn } = await import('child_process');

      // Use spawn to pipe prompt via stdin — avoids shell escaping issues
      const claude = spawn('claude', ['-p', '-', '--max-turns', '3'], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      claude.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      claude.on('close', (code: number | null) => {
        if (stderr) {
          console.error(`Persona ${persona.name} stderr:`, stderr.substring(0, 200));
        }

        const response = stdout.trim();
        if (response && response.length > 0) {
          resolve(response);
          return;
        }

        console.warn(`Claude Code returned empty/failed (code ${code}) for ${persona.name}`);
        resolve(''); // Return empty so retry logic can fire
      });

      claude.on('error', (err: Error) => {
        console.error(`Claude Code spawn failed for ${persona.name}:`, err.message);
        resolve(''); // Return empty so retry logic can fire
      });

      // Write prompt to stdin and close it
      claude.stdin.write(prompt);
      claude.stdin.end();

    } catch (error) {
      console.error(`Claude Code failed for ${persona.name}:`, error);
      resolve(''); // Return empty so retry logic can fire
    }
  });
}

// Extract and store inferred memories from conversation
async function extractAndStoreInferredMemory(
  personaId: string,
  userId: string,
  userMessage: string,
  aiResponse: string
): Promise<void> {
  // Look for patterns that suggest something worth remembering
  const patterns = [
    // User preferences
    { regex: /i (?:always|usually|prefer|like to|tend to) (.+)/i, category: 'preferences' as const },
    // Project context
    { regex: /(?:our|the) project (?:is|uses|has) (.+)/i, category: 'context' as const },
    { regex: /we(?:'re| are) (?:using|building|working on) (.+)/i, category: 'context' as const },
    // Tech stack mentions
    { regex: /(?:we|our team|I) use (\w+(?:\s+\w+){0,3}) (?:for|as|to)/i, category: 'context' as const },
    // Naming conventions
    { regex: /(?:we|I) (?:follow|use|prefer) (\w+[\s-]?(?:case|convention|style|pattern))/i, category: 'preferences' as const },
    // Workflow preferences
    { regex: /(?:our|my) (?:workflow|process|pipeline) (?:is|involves|includes) (.+)/i, category: 'context' as const },
    // Team structure — use group index 0 (full match) to capture "X handles the Y"
    { regex: /(\w+) (?:is|handles|manages|owns) (?:the|our) (.{10,60})/i, category: 'relationships' as const, useFullMatch: true },
  ];

  for (const { regex, category, useFullMatch } of (patterns as Array<{ regex: RegExp; category: 'preferences' | 'context' | 'relationships'; useFullMatch?: boolean }>)) {
    const match = userMessage.match(regex);
    if (match) {
      const content = useFullMatch ? match[0].trim() : (match[1] ? match[1].trim() : match[0].trim());
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

  // Extract learning from AI response (what advice was given)
  // Rate-limited: only extract from ~1 in 5 responses to avoid polluting memory
  if (aiResponse.length > 50 && Math.random() < 0.2) {
    const advicePatterns = [
      /(?:I recommend|I suggest|you should|consider) (.{20,120})/i,
      /(?:the best approach|a good pattern) (?:is|would be) (.{20,120})/i,
    ];
    for (const pattern of advicePatterns) {
      const match = aiResponse.match(pattern);
      if (match) {
        try {
          await addMemoryEntry(personaId, userId, {
            category: 'context',
            content: `Previously advised: ${match[1].trim().substring(0, 100)}`,
            keywords: match[1].toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5),
            source: 'inferred',
            importance: 2 // Very low importance — will be evicted if not reinforced
          });
        } catch (error) {
          // Silently fail
        }
        break; // Only store one advice per response at most
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
