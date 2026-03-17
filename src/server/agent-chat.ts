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
import { 
  addMessage, 
  getMessages, 
  ChatMessage,
  acquireSpeakingTurn,
  releaseSpeakingTurn,
  getChannel
} from './chat-storage.js';
import { getAllTasks, createTask, getTask, updateTask } from './storage.js';
import { getCachedPRs } from './pr-cache.js';
import { Persona, Task, Comment } from '../client/types/index.js';
import { getRelevantKnowledge } from './persona-knowledge.js';
import {
  TokenTracker,
  buildBudgetedSection,
  getDefaultBudget
} from './token-budget.js';
import { getConversationBackground, maybeUpdateSummary } from './chat-summarizer.js';
import { getSlackData } from './slx-service.js';
import { renderWorkspaceContext, getCachedWorkspaceContext } from './workspace-context.js';


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

  // Process each mentioned persona sequentially to ensure fair turn-taking
  // When multiple personas are mentioned, they respond one at a time
  for (const persona of mentionedPersonas) {
    // Handle remember command
    if (rememberCmd) {
      await handleRememberCommand(persona, message, rememberCmd);
      continue;
    }

    // Generate contextual response - await to ensure fair queuing
    try {
      await generatePersonaResponse(message, persona);
    } catch (error) {
      console.error(`Failed to generate response for persona ${persona.name}:`, error);
    }
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

// Build relevance-filtered Slack context
function buildSlackContext(
  slackData: any,
  _persona: Persona,
  messageContent: string
): string {
  if (!slackData || (!slackData.digest && !slackData.mentions.length)) {
    return 'No recent Slack activity available.';
  }

  const sections: string[] = [];
  const messageLower = messageContent.toLowerCase();

  // Check if message mentions Slack-related keywords
  const slackKeywords = ['slack', 'message', 'respond', 'reply', 'mention', 'channel', 'dm', 'digest'];
  const mentionsSlack = slackKeywords.some(kw => messageLower.includes(kw));

  // Always include digest if available
  if (slackData.digest) {
    sections.push('**Latest Slack Digest:**');
    sections.push(slackData.digest.trim());
  }

  // Include mentions if they exist
  if (slackData.mentions && slackData.mentions.length > 0) {
    sections.push('\n**Recent Mentions:**');
    const recentMentions = slackData.mentions.slice(0, 5);
    for (const mention of recentMentions) {
      sections.push(`- ${mention.channel}: ${mention.author} - ${mention.text.substring(0, 100)}...`);
    }
    if (slackData.mentions.length > 5) {
      sections.push(`... and ${slackData.mentions.length - 5} more mentions`);
    }
  }

  // Include channel summaries if discussing specific channels
  if (mentionsSlack && slackData.channels && slackData.channels.length > 0) {
    sections.push('\n**Channel Activity:**');
    const relevantChannels = slackData.channels.filter((ch: any) =>
      messageLower.includes(ch.name) || mentionsSlack
    ).slice(0, 3);
    for (const channel of relevantChannels) {
      sections.push(`- #${channel.name}: Recent activity available`);
    }
  }

  return sections.join('\n') || 'No relevant Slack activity.';
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
  let turnAcquired = false;
  try {
    console.log(`🤖 Generating response for persona: ${persona.name} (${persona.emoji})`);
    
    // Try to acquire speaking turn (implements turn-taking)
    const acquired = await acquireSpeakingTurn(originalMessage.channelId, persona.id);
    if (!acquired) {
      console.log(`🚫 ${persona.name} cannot respond - another persona is speaking`);
      return;
    }
    turnAcquired = true;

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
    
    // Get task context if this is a task channel
    let taskContext = '';
    if (channelType === 'task') {
      try {
        const channel = await getChannel(originalMessage.channelId);
        if (channel && channel.taskId) {
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
      } catch (error) {
        console.warn(`Failed to get task context: ${error}`);
      }
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

    // Get Slack context for personas that need it (especially PR)
    let slackContext = '';
    if (persona.specialties.some(s => ['slack', 'communication', 'messaging'].includes(s))) {
      try {
        const slackData = await getSlackData();
        slackContext = buildSlackContext(slackData, persona, originalMessage.content);
      } catch (error) {
        console.warn(`Failed to get Slack context: ${error}`);
      }
    }

    // Get workspace context (repos, board overview, recent reports)
    let workspaceContext = '';
    try {
      const wsContext = await getCachedWorkspaceContext();
      workspaceContext = renderWorkspaceContext(wsContext, 800); // Reserve ~800 tokens
    } catch (error) {
      console.warn(`Failed to get workspace context: ${error}`);
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
      taskContext,
      boardContext,
      prContext,
      knowledgeContext,
      slackContext,
      workspaceContext,
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
      taskContext, // Keep task context on retry (important for task conversations)
      boardContext: '', // Strip board on retry
      prContext: '', // Strip PRs on retry
      knowledgeContext: '', // Strip knowledge on retry
      slackContext: '', // Strip slack on retry
      workspaceContext: '', // Strip workspace on retry
      tracker: new TokenTracker(),
      budget
    });

    if (response && response.length > 0) {
      // Parse and execute any actions from the response
      const { cleanResponse, actions, memories } = parseResponseActions(response);

      // Post the conversational part of the response
      await addMessage(
        originalMessage.channelId,
        persona.name,
        'persona',
        cleanResponse,
        originalMessage.id
      );

      // Store any AI-extracted memories
      if (memories.length > 0) {
        console.log(`💾 ${persona.name} extracted ${memories.length} memories from conversation`);
        for (const mem of memories) {
          // Map singular category names to plural (in case AI uses singular)
          const categoryMap: Record<string, string> = {
            relationship: 'relationships',
            relationships: 'relationships',
            preference: 'preferences',
            preferences: 'preferences',
            instruction: 'instructions',
            instructions: 'instructions',
            context: 'context',
            learning: 'learning',
            reflection: 'reflection',
          };
          const category = categoryMap[mem.category] || 'context';
          try {
            await addMemoryEntry(persona.id, userId, {
              category: category as any,
              content: mem.content,
              keywords: mem.content.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 10),
              source: 'inferred',
              importance: Math.min(10, Math.max(1, mem.importance)),
            });
            console.log(`  💾 Stored: [${category}] ${mem.content.substring(0, 60)}...`);
          } catch (memErr) {
            console.error('Failed to store extracted memory:', memErr);
          }
        }
      }

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
          // Map action types to user-friendly error messages
          const errorMessages: Record<string, string> = {
            create_task: 'create that ticket',
            update_task: 'update that task',
            add_comment: 'add a comment',
            read_file: 'read that file',
          };
          const actionVerb = errorMessages[action.action] || 'perform that action';
          await addMessage(
            originalMessage.channelId,
            persona.name,
            'persona',
            `⚠️ I tried to ${actionVerb} but hit an error: ${actionErr instanceof Error ? actionErr.message : 'Unknown error'}`
          );
        }
      }

      // Fallback: also check with regex-based extraction (catches things the AI might miss)
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
  } finally {
    // Only release turn if it was actually acquired
    if (turnAcquired) {
      try {
        await releaseSpeakingTurn(originalMessage.channelId, persona.id);
      } catch (releaseError) {
        console.error('Failed to release speaking turn:', releaseError);
        // Don't rethrow - we don't want to mask the original error
      }
    }
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
  taskContext?: string; // Task context for task channel conversations
  boardContext: string;
  prContext: string;
  knowledgeContext?: string;
  slackContext?: string;
  workspaceContext?: string;
  tracker: TokenTracker;
  budget: ReturnType<typeof getDefaultBudget>;
}

function buildChatPrompt(context: PromptContext): string {
  const { soul, persona, originalMessage, chatHistory, conversationBackground, memoryContext, relevantMemories, teamContext, taskContext, boardContext, prContext, knowledgeContext, slackContext, workspaceContext, tracker, budget } = context;

  const sections: string[] = [];

  // Current date/time (needed for reminder scheduling)
  const now = new Date();
  sections.push(`\n## Current Date & Time\n${now.toUTCString()} (UTC)\nLocal ISO: ${now.toISOString()}`);

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

  // Workspace context (repos, board summary, reports)
  if (workspaceContext) {
    sections.push(`\n## Workspace Context\n${workspaceContext}`);
  }

  // Task context (for task channel conversations) - use budgeted tracker
  if (taskContext) {
    sections.push(tracker.record('task', buildBudgetedSection(
      'Task',
      `\n${taskContext}`,
      budget.task
    )));
  }

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

  // Slack context (for personas that need it, especially PR)
  if (slackContext) {
    sections.push(tracker.record('slack', buildBudgetedSection(
      'Slack',
      `\n## Slack Activity\n${slackContext}`,
      budget.knowledge // Use knowledge budget for slack context
    )));
  }

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

## Memory Extraction
Occasionally, when the user shares something genuinely worth keeping long-term, you may silently add a memory block at the END of your response. These are parsed automatically and NOT shown to the user.

\`\`\`memory
{"category":"relationships","content":"Mac is the user's direct manager","importance":8}
\`\`\`

**Only save a memory if ALL of these are true:**
- It's a clear, durable fact (a person's role, an explicit preference, a standing instruction)
- The user stated it directly — don't infer or paraphrase casual remarks
- It's something you'd genuinely want to recall weeks from now
- You haven't already stored this fact

**Never save a memory for:**
- Questions, greetings, or back-and-forth chat
- Things the user is just mentioning in passing
- Rephrasing what they just said back at them
- General discussion or opinions
- Anything you're uncertain about

Categories: "relationships" (people, roles), "preferences" (how user likes things done), "instructions" (explicit standing rules), "context" (key project/domain facts)
Importance: 8+ for key people/roles, 6-7 for genuinely useful context. If in doubt, don't save it.

**Most messages need zero memory blocks. Prioritise being a good conversationalist over collecting facts.**

## Actions You Can Take

### Create a ticket
You can create tickets on the kanban board when the user asks. Include a JSON block in your response like this:

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

### Set a reminder
You can set reminders for the user. When they ask you to remind them of something at a specific time, include:

\`\`\`action
{"action":"create_reminder","message":"What to remind them about","remindAt":"2026-03-11T09:00:00.000Z","taskId":"optional-task-id"}
\`\`\`

Guidelines for reminders:
- **message** — a clear, concise reminder message (what they asked to be reminded about)
- **remindAt** — ISO 8601 timestamp. Today's date/time context is in the system prompt. Interpret "tomorrow at 9am", "in 2 hours", "next Monday" etc. relative to now.
- **taskId** — optional, include if the reminder is about a specific task
- Always confirm in your response text what you've set and when it will fire
- If the user doesn't specify a time, ask them when they'd like to be reminded`;

  if (persona.id === 'product-manager') {
    instructions += `

## Special Actions for Product Manager

You have additional capabilities as a PM Coordinator:

### 1. Read Files

You can read codebase files to understand architecture before decomposing epics:

\`\`\`action
{"action":"read_file","path":"src/server/agent-chat.ts"}
\`\`\`

The file content will appear in the chat conversation. You can read multiple files.

**Security**: Only read files in the project workspace. Path traversal (..) is blocked.

### 2. Propose-Before-Create Pattern

**IMPORTANT**: When decomposing epics, follow this flow:

**Step 1**: Propose tickets in plain chat (NO action blocks yet)
- Describe each ticket with title, priority, assignee, description
- Number them clearly
- Ask for confirmation: "Sound good? Say 'create all' to proceed."

**Step 2**: Wait for user confirmation
- User can say "do it", "create all", "yes", etc.
- User can request changes: "change ticket 3 to use QA instead"
- Refine your proposal based on feedback

**Step 3**: Create tickets only after confirmation
- Use multiple \`create_task\` action blocks
- One action block per ticket

### 3. Creating Multiple Related Tickets

After user confirms, create tickets with action blocks:

\`\`\`action
{"action":"create_task","title":"Add DSS calculation logic","description":"Implement DSS indicator calculation\\n\\nAcceptance Criteria:\\n- Calculate DSS from price data\\n- Return bearish/bullish state\\n- Unit tests pass","assignee":"developer","priority":300,"tags":["indicator","logic"]}
\`\`\`

\`\`\`action
{"action":"create_task","title":"Wire DSS events into context","description":"Integrate DSS signals into strategy context\\n\\nDependencies:\\n- DSS calculation must be complete\\n\\nAcceptance Criteria:\\n- DSS state available in context\\n- Events trigger correctly","assignee":"developer","priority":300,"tags":["integration","events"]}
\`\`\`

### 4. Right-Sized Tickets

Each ticket should be completable in **5-10 minutes** by an AI agent:
- **Single focus**: One clear objective
- **Too large signals**: >3 implementation bullets, touches >3 files
- **Break down**: Separate logic from integration, backend from frontend, core from edge cases

### 5. Update Tasks

You can update existing tasks:

\`\`\`action
{"action":"update_task","taskId":"ABC123","status":"in-progress","assignee":"qa-engineer"}
\`\`\`

Fields you can update: title, description, status, priority, assignee, tags

### 6. Add Comments

You can comment on tasks:

\`\`\`action
{"action":"add_comment","taskId":"ABC123","body":"This is blocked waiting for API design to be finalized."}
\`\`\`

### 7. Query Board State

The board context in this prompt shows current tasks. You can reference it to:
- Check what's already in progress
- Avoid duplicate tickets
- Suggest next priorities based on current workload`;
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

interface ExtractedMemory {
  category: string;
  content: string;
  importance: number;
}

function parseResponseActions(response: string): { cleanResponse: string; actions: ResponseAction[]; memories: ExtractedMemory[] } {
  const actions: ResponseAction[] = [];
  const memories: ExtractedMemory[] = [];

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

  // Match ```memory ... ``` blocks
  const memoryBlockRegex = /```memory\s*\n?([\s\S]*?)```/g;
  while ((match = memoryBlockRegex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.content && parsed.category) {
        memories.push({
          category: parsed.category,
          content: parsed.content,
          importance: parsed.importance || 5,
        });
      }
    } catch (e) {
      console.warn('Failed to parse memory block:', match[1]);
    }
  }

  // Remove action and memory blocks from the response to get clean conversational text
  const cleanResponse = response
    .replace(/```action\s*\n?[\s\S]*?```/g, '')
    .replace(/```memory\s*\n?[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanResponse, actions, memories };
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

    case 'update_task': {
      if (!action.taskId) {
        throw new Error('Task ID is required');
      }

      const updates: Partial<Task> = {};
      if (action.title !== undefined) updates.title = action.title;
      if (action.description !== undefined) updates.description = action.description;
      if (action.status !== undefined) updates.status = action.status;
      if (action.priority !== undefined) updates.priority = action.priority;
      if (action.assignee !== undefined) {
        updates.assignee = action.assignee;
        updates.persona = action.assignee;
      }
      if (action.tags !== undefined) updates.tags = action.tags;

      const task = await updateTask(action.taskId, updates, persona.name);

      if (!task) {
        throw new Error(`Task not found: ${action.taskId}`);
      }

      const changes = Object.keys(updates).join(', ');
      return `✏️ **Updated task** ${task.id}: ${changes}`;
    }

    case 'add_comment': {
      if (!action.taskId || !action.body) {
        throw new Error('Task ID and comment body are required');
      }

      const comment: Comment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        taskId: action.taskId,
        author: persona.name,
        body: action.body,
        createdAt: new Date()
      };

      // Read task and build updated comments array
      const existingTask = await getTask(action.taskId);
      if (!existingTask) {
        throw new Error(`Task ${action.taskId} not found`);
      }

      const existingComments = existingTask.comments || [];
      const updatedComments = [...existingComments, comment];

      // Pass comments array to updateTask
      const task = await updateTask(action.taskId, { comments: updatedComments }, persona.name);

      return `💬 **Comment added** to task ${task?.id}`;
    }

    case 'create_reminder': {
      if (!action.message || !action.remindAt) {
        throw new Error('Reminder message and remindAt are required');
      }

      const remindAt = new Date(action.remindAt);
      if (isNaN(remindAt.getTime())) {
        throw new Error(`Invalid remindAt date: "${action.remindAt}"`);
      }

      // POST to our own reminders API
      const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
      const res = await fetch(`${baseUrl}/api/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: action.message,
          remindAt: remindAt.toISOString(),
          taskId: action.taskId || undefined,
          creator: persona.name,
          target: action.target || 'human:user',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`Failed to create reminder: ${err.error}`);
      }

      const formatted = remindAt.toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit'
      });
      return `⏰ **Reminder set** for ${formatted}: "${action.message}"`;
    }

    case 'read_file': {
      if (!action.path) {
        throw new Error('File path is required');
      }

      // Import fs at the top if not already
      const fs = await import('fs/promises');
      const path = await import('path');

      try {
        // Resolve path relative to workspace or absolute
        const resolvedPath = path.isAbsolute(action.path) 
          ? action.path 
          : path.join(process.cwd(), action.path);

        // Security: validate path is within workspace
        const normalizedPath = path.normalize(resolvedPath);
        const workspaceRoot = process.cwd();
        if (!normalizedPath.startsWith(workspaceRoot + path.sep) && normalizedPath !== workspaceRoot) {
          throw new Error('Path outside workspace not allowed');
        }

        // Read file content
        const content = await fs.readFile(normalizedPath, 'utf8');
        
        // Truncate very large files
        const maxLength = 10000; // ~10KB limit for context
        const truncated = content.length > maxLength;
        const displayContent = truncated ? content.slice(0, maxLength) + '\n\n[... truncated ...]' : content;

        // Return inline in the conversation (will be part of chat history)
        return `📄 **Read file:** \`${action.path}\`\n\n\`\`\`\n${displayContent}\n\`\`\``;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${action.path}`);
        }
        throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
