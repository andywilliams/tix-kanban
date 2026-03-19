/**
 * Intent Detection for Persona Chat
 * 
 * Distinguishes between action requests and discussion/questions
 * to enable direct execution mode
 */

export interface IntentResult {
  intent: 'action' | 'discussion' | 'clarification_needed';
  confidence: number;
  reasoning?: string;
  extractedTask?: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

// Action keywords and phrases that indicate executable intent
// Note: These must NOT match question words (how, what, why, etc.) at start of string
const ACTION_PATTERNS = [
  /^(go ahead|do it|make it|create|add|implement|build|fix|update|change)/i,
  // Negative lookbehind: exclude if preceded by question words at start
  /^(?!how|what|why|when|where|who|which|should|would|could|can)\S*(please )?(go ahead|do it|make it|create|add|implement|build|fix|update|change)/i,
  /can you (create|add|implement|build|fix|update|change)/i,
  /could you (create|add|implement|build|fix|update|change)/i,
  /would you (create|add|implement|build|fix|update|change)/i,
  /I need you to (create|add|implement|build|fix|update|change)/i,
  /I want you to (create|add|implement|build|fix|update|change)/i,
];

// Discussion keywords that suggest the user wants to talk, not execute
const DISCUSSION_PATTERNS = [
  /^(what|how|why|when|where|who|which|should|would|could)/i,
  /(what do you think|how would you|why do you|explain|tell me about)/i,
  /(thoughts on|opinion on|do you think)/i,
  /(help me understand|walk me through)/i,
];

// Vague patterns that need clarification
const VAGUE_PATTERNS = [
  /^(that|this|it)$/i,
  /^(do that|do this|make that|build that|fix that|add that)$/i,
];

/**
 * Detect user intent from a chat message
 * 
 * Uses lightweight heuristics to classify messages as:
 * - action: User wants something done (spawn sub-agent)
 * - discussion: User wants to discuss/explore (normal chat)
 * - clarification_needed: Request is too vague (ask for details)
 */
export function detectIntent(
  message: string,
  recentContext?: string[]
): IntentResult {
  // Strip @mentions from the message before pattern matching
  // e.g. "@Developer fix the login bug" -> "fix the login bug"
  // Support hyphenated persona names like "code-reviewer"
  const cleanedMessage = message.replace(/^@[\w-]+\s+/i, '').trim();
  const trimmed = cleanedMessage;
  
  // Check for vague patterns first
  if (VAGUE_PATTERNS.some(p => p.test(trimmed))) {
    return {
      intent: 'clarification_needed',
      confidence: 0.9,
      reasoning: 'Message is too vague - needs more detail'
    };
  }

  // Check for action patterns BEFORE discussion patterns
  // (to avoid "could you fix X" being treated as discussion)
  if (ACTION_PATTERNS.some(p => p.test(trimmed))) {
    // Extract potential task details
    const extractedTask = extractTaskDetails(trimmed, recentContext);
    
    return {
      intent: 'action',
      confidence: 0.9,
      reasoning: 'Clear action request detected',
      extractedTask
    };
  }

  // Check for discussion patterns
  if (DISCUSSION_PATTERNS.some(p => p.test(trimmed))) {
    return {
      intent: 'discussion',
      confidence: 0.85,
      reasoning: 'Question or request for explanation'
    };
  }

  // Look for imperative mood (commands)
  const imperativeScore = scoreImperativeMood(trimmed);
  if (imperativeScore > 0.6) {
    return {
      intent: 'action',
      confidence: imperativeScore,
      reasoning: 'Imperative command detected',
      extractedTask: extractTaskDetails(trimmed, recentContext)
    };
  }

  // Default to discussion if uncertain
  return {
    intent: 'discussion',
    confidence: 0.5,
    reasoning: 'No clear action indicators - treating as discussion'
  };
}

/**
 * Score how imperative/command-like a message is
 * Returns 0-1 score
 */
function scoreImperativeMood(message: string): number {
  let score = 0;
  
  // Starts with a verb (common in commands)
  const startsWithVerb = /^(add|remove|delete|update|create|fix|build|implement|change|make|set|get)/i.test(message);
  if (startsWithVerb) score += 0.4;
  
  // Short and direct (commands are usually concise)
  const wordCount = message.split(/\s+/).length;
  if (wordCount <= 10) score += 0.2;
  
  // Contains direct objects without questions
  const hasDirectObject = /\b(a|an|the)\s+\w+/i.test(message) && !/\?/.test(message);
  if (hasDirectObject) score += 0.2;
  
  // Not a question
  if (!/\?/.test(message)) score += 0.2;
  
  return Math.min(score, 1.0);
}

/**
 * Extract task details from a message
 * Combines current message with recent context to build fuller picture
 */
function extractTaskDetails(
  message: string,
  recentContext?: string[]
): IntentResult['extractedTask'] {
  const details: IntentResult['extractedTask'] = {};
  
  // Try to extract title from the message
  // Look for patterns like "create a dark mode toggle" -> "dark mode toggle"
  const titleMatch = message.match(/(?:create|add|implement|build|fix)\s+(?:a|an|the)?\s*([^,.!?]+)/i);
  if (titleMatch) {
    details.title = titleMatch[1].trim();
  }
  
  // Use the full message as description if no title extracted
  if (!details.title) {
    details.description = message;
  }
  
  // Look for feature-related keywords to suggest tags
  const tags: string[] = [];
  if (/dark mode|theme|styling|ui/i.test(message)) tags.push('ui', 'feature');
  if (/bug|fix|error|issue/i.test(message)) tags.push('bug');
  if (/api|endpoint|backend/i.test(message)) tags.push('backend');
  if (/test|testing|spec/i.test(message)) tags.push('testing');
  
  if (tags.length > 0) {
    details.tags = tags;
  }
  
  // Include recent context in description if available
  if (recentContext && recentContext.length > 0) {
    const contextSummary = recentContext.slice(-3).join('\n');
    details.description = `${message}\n\nContext:\n${contextSummary}`;
  } else if (!details.description) {
    details.description = message;
  }
  
  return details;
}

/**
 * Build clarification prompt when intent is unclear
 */
export function buildClarificationPrompt(message: string): string {
  return `I want to make sure I understand correctly. When you say "${message}", do you mean:

1. You'd like me to **execute this now** (I'll spawn a sub-agent to implement it)?
2. You want to **discuss the approach** first?
3. Something else?

Let me know and I'll proceed accordingly!`;
}
