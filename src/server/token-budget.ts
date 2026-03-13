/**
 * Token Budget Management
 *
 * Manages token allocation across prompt sections to prevent
 * context overflow and ensure each section gets appropriate space.
 */

// Rough estimate: ~4 chars per token
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Truncate text to fit within a token budget, preserving complete lines
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  // Approximate character limit
  const charLimit = maxTokens * 4;
  const lines = text.split('\n');
  let result = '';
  let charCount = 0;

  for (const line of lines) {
    if (charCount + line.length + 1 > charLimit) break;
    result += (result ? '\n' : '') + line;
    charCount += line.length + 1;
  }

  if (result.length < text.length) {
    result += '\n... (truncated)';
  }

  return result;
}

// Token budget allocations for the chat prompt
export interface TokenBudget {
  soul: number;
  personaPrompt: number;
  memory: number;
  task: number;
  knowledge: number;
  board: number;
  prs: number;
  chatHistory: number;
  instructions: number;
  total: number;
}

// Default budget: ~80k tokens total prompt, leaving room for response
export function getDefaultBudget(): TokenBudget {
  return {
    soul: 5000,
    personaPrompt: 3000,
    memory: 3000,
    task: 2500,
    knowledge: 5000,
    board: 3000,
    prs: 2000,
    chatHistory: 4000,
    instructions: 3000,
    total: 80000,
  };
}

// Build a prompt section with budget enforcement
export function buildBudgetedSection(
  _label: string,
  content: string,
  maxTokens: number
): string {
  if (!content || content.trim().length === 0) return '';
  const truncated = truncateToTokenBudget(content, maxTokens);
  return truncated;
}

// Track token usage across sections
export class TokenTracker {
  private used: Map<string, number> = new Map();
  private budget: TokenBudget;

  constructor(budget?: TokenBudget) {
    this.budget = budget || getDefaultBudget();
  }

  // Record tokens used by a section
  record(section: string, text: string): string {
    const tokens = estimateTokens(text);
    this.used.set(section, tokens);
    return text;
  }

  // Get remaining tokens
  get remaining(): number {
    let totalUsed = 0;
    for (const tokens of this.used.values()) {
      totalUsed += tokens;
    }
    return Math.max(0, this.budget.total - totalUsed);
  }

  // Get total tokens used
  get totalUsed(): number {
    let total = 0;
    for (const tokens of this.used.values()) {
      total += tokens;
    }
    return total;
  }

  // Get budget for a specific section
  getBudget(section: keyof TokenBudget): number {
    return this.budget[section] as number;
  }

  // Log usage summary
  getSummary(): string {
    const lines: string[] = ['Token usage:'];
    for (const [section, tokens] of this.used.entries()) {
      lines.push(`  ${section}: ~${tokens} tokens`);
    }
    lines.push(`  TOTAL: ~${this.totalUsed} / ${this.budget.total}`);
    return lines.join('\n');
  }
}
