import fs from 'fs/promises';
import path from 'path';
import { getDailyActivity } from './activityTracker.js';
import OpenAI from 'openai';

const SUMMARIES_DIR = path.join(process.cwd(), 'daily-summaries');

// Ensure summaries directory exists
async function ensureSummariesDirectory(): Promise<void> {
  try {
    await fs.mkdir(SUMMARIES_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create summaries directory:', error);
    throw error;
  }
}

// Get path for a specific date's summary
function getSummaryPath(date: string): string {
  return path.join(SUMMARIES_DIR, `${date}.md`);
}

// Read summary for a specific date
export async function readSummary(date: string): Promise<string | null> {
  try {
    const summaryPath = getSummaryPath(date);
    const content = await fs.readFile(summaryPath, 'utf8');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`Failed to read summary for ${date}:`, error);
    throw error;
  }
}

// Generate daily summary using LLM
export async function generateDailySummary(date?: string): Promise<string> {
  const summaryDate = date || new Date().toISOString().split('T')[0];
  
  try {
    // Get activity for the day
    const activity = await getDailyActivity(summaryDate);
    
    // If no activity, return a simple message
    if (Object.keys(activity.personas).length === 0) {
      const emptyMessage = `# ${summaryDate} — Daily Summary

No activity recorded for this day.
`;
      await writeSummary(summaryDate, emptyMessage);
      return emptyMessage;
    }
    
    // Build activity context for LLM
    const activityContext = buildActivityContext(activity);
    
    // Call LLM to synthesize summary
    const summary = await synthesizeSummary(summaryDate, activityContext);
    
    // Save summary
    await writeSummary(summaryDate, summary);
    
    return summary;
  } catch (error) {
    console.error('Failed to generate daily summary:', error);
    throw error;
  }
}

// Build activity context from daily activity data
function buildActivityContext(activity: any): string {
  let context = '';
  
  for (const [personaId, persona] of Object.entries<any>(activity.personas)) {
    context += `\n## ${persona.personaName} (${personaId})\n`;
    
    // Tasks started
    if (persona.tasks.started.length > 0) {
      context += `\n### Started (${persona.tasks.started.length})\n`;
      for (const task of persona.tasks.started) {
        const repo = task.repo ? `[${task.repo}] ` : '';
        context += `- ${repo}${task.title} (${task.taskId})\n`;
      }
    }
    
    // Tasks completed
    if (persona.tasks.completed.length > 0) {
      context += `\n### Completed (${persona.tasks.completed.length})\n`;
      for (const task of persona.tasks.completed) {
        const repo = task.repo ? `[${task.repo}] ` : '';
        const pr = task.pr ? ` - ${task.pr}` : '';
        context += `- ${repo}${task.title} (${task.taskId})${pr}\n`;
      }
    }
    
    // Tasks failed
    if (persona.tasks.failed.length > 0) {
      context += `\n### Failed (${persona.tasks.failed.length})\n`;
      for (const task of persona.tasks.failed) {
        const repo = task.repo ? `[${task.repo}] ` : '';
        const reason = task.reason ? ` - ${task.reason}` : '';
        context += `- ${repo}${task.title} (${task.taskId})${reason}\n`;
      }
    }
    
    // PRs created
    if (persona.prs.created.length > 0) {
      context += `\n### PRs Created (${persona.prs.created.length})\n`;
      for (const pr of persona.prs.created) {
        context += `- [${pr.repo}] PR #${pr.prNumber}: ${pr.prUrl}\n`;
      }
    }
    
    // PRs merged
    if (persona.prs.merged.length > 0) {
      context += `\n### PRs Merged (${persona.prs.merged.length})\n`;
      for (const pr of persona.prs.merged) {
        context += `- [${pr.repo}] PR #${pr.prNumber}: ${pr.prUrl}\n`;
      }
    }
    
    // Reviews completed
    if (persona.reviews.completed.length > 0) {
      context += `\n### Reviews Completed (${persona.reviews.completed.length})\n`;
      for (const review of persona.reviews.completed) {
        const outcome = review.outcome ? ` (${review.outcome})` : '';
        context += `- ${review.title}${outcome}\n`;
      }
    }
  }
  
  return context;
}

// Synthesize summary using LLM
async function synthesizeSummary(date: string, activityContext: string): Promise<string> {
  // Use OpenAI-compatible API (works with OpenRouter)
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('No API key found. Set OPENROUTER_API_KEY or OPENAI_API_KEY');
  }
  
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_API_KEY 
      ? 'https://openrouter.ai/api/v1'
      : undefined
  });
  
  const model = process.env.SUMMARY_MODEL || 'anthropic/claude-sonnet-4-5';
  
  const prompt = `You are synthesizing a daily activity summary for AI worker personas in a kanban system.

Date: ${date}

Activity data:
${activityContext}

Generate a narrative daily summary in this format:

# ${date} — Daily Summary

## Completed
- [repo] Task description (PR #X, merged/created)

## In Progress
- [repo] Task description (X/Y subtasks or progress indicator)

## Failures & Lessons
- What failed and what we learned

## Decisions
- Key decisions made (if any)

Instructions:
1. Write in a clear, narrative style
2. Group related work together by repo/theme
3. Highlight meaningful accomplishments, not just activity counts
4. For failures, extract lessons learned (what caused it, how to prevent)
5. Be concise but informative
6. If a section is empty, you can omit it or write "None"

Generate the summary now:`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });
    
    const summary = response.choices[0]?.message?.content?.trim() || '';
    if (!summary) {
      throw new Error('LLM returned empty summary');
    }
    
    return summary;
  } catch (error) {
    console.error('Failed to call LLM for summary generation:', error);
    
    // Fallback: generate a basic summary without LLM
    return generateBasicSummary(date, activityContext);
  }
}

// Fallback: generate basic summary without LLM
function generateBasicSummary(date: string, activityContext: string): string {
  return `# ${date} — Daily Summary

${activityContext}

_Note: This is a basic activity log. LLM synthesis failed._
`;
}

// Write summary to file
async function writeSummary(date: string, summary: string): Promise<void> {
  try {
    await ensureSummariesDirectory();
    const summaryPath = getSummaryPath(date);
    await fs.writeFile(summaryPath, summary, 'utf8');
  } catch (error) {
    console.error(`Failed to write summary for ${date}:`, error);
    throw error;
  }
}

// Get yesterday's and today's summaries for persona context
export async function getRecentSummaries(): Promise<string> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  const yesterdaySummary = await readSummary(yesterdayStr);
  const todaySummary = await readSummary(todayStr);
  
  let context = '';
  
  if (yesterdaySummary) {
    context += `## Yesterday's Activity\n\n${yesterdaySummary}\n\n`;
  }
  
  if (todaySummary) {
    context += `## Today's Activity So Far\n\n${todaySummary}\n`;
  }
  
  return context;
}
