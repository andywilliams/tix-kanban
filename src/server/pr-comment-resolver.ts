import * as cron from 'node-cron';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { getUserSettings, saveUserSettings } from './user-settings.js';
import { getGitHubConfig } from './github.js';
import { executeWithRateLimit } from './github-rate-limit.js';
import { saveReport } from './reports-storage.js';

const exec = promisify(execCallback);

interface PRComment {
  id: number;
  body: string;
  user: { login: string };
  createdAt: string;
  updatedAt: string;
  url: string;
  path?: string; // For review comments
  line?: number; // For review comments
  side?: 'LEFT' | 'RIGHT'; // For review comments
  startLine?: number; // For multi-line comments
}

interface PRCommentWithContext extends PRComment {
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  isReviewComment: boolean;
}

interface ResolverState {
  isRunning: boolean;
  lastRun?: string;
  lastTaskCount?: number;
}

let resolverCronJob: cron.ScheduledTask | null = null;
let resolverState: ResolverState = {
  isRunning: false
};

// Execute Claude CLI with prompt via stdin
function executeClaudeWithStdin(prompt: string, args: string[] = [], timeoutMs: number = 120000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const claudeArgs = ['-p', ...args];
    const fullCommand = `claude ${claudeArgs.map(a => `'${a}'`).join(' ')}`;

    console.log(`[pr-resolver] Running: ${fullCommand}`);
    const child = spawn(fullCommand, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: true
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Claude process exited with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    // Send prompt via stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Get all unresolved comments from a PR
async function getUnresolvedComments(repo: string, prNumber: number): Promise<PRCommentWithContext[]> {
  return executeWithRateLimit(async () => {
    const comments: PRCommentWithContext[] = [];

    // Get PR details first
    const { stdout: prData } = await exec(`gh pr view ${prNumber} --repo ${repo} --json title,url`);
    const pr = JSON.parse(prData);

    // Get issue comments
    try {
      const { stdout: issueCommentsData } = await exec(
        `gh api repos/${repo}/issues/${prNumber}/comments --jq '.[] | {id, body, user: {login: .user.login}, createdAt: .created_at, updatedAt: .updated_at, url: .html_url}'`
      );

      if (issueCommentsData.trim()) {
        const issueComments = issueCommentsData.split('\n').filter(Boolean).map(line => {
          const comment = JSON.parse(line);
          return {
            ...comment,
            repo,
            prNumber,
            prTitle: pr.title,
            prUrl: pr.url,
            isReviewComment: false
          };
        });
        comments.push(...issueComments);
      }
    } catch (error) {
      console.warn(`Failed to fetch issue comments for PR #${prNumber}:`, error);
    }

    // Get review comments
    try {
      const { stdout: reviewCommentsData } = await exec(
        `gh api repos/${repo}/pulls/${prNumber}/comments --jq '.[] | {id, body, user: {login: .user.login}, createdAt: .created_at, updatedAt: .updated_at, url: .html_url, path, line, side, startLine: .start_line}'`
      );

      if (reviewCommentsData.trim()) {
        const reviewComments = reviewCommentsData.split('\n').filter(Boolean).map(line => {
          const comment = JSON.parse(line);
          return {
            ...comment,
            repo,
            prNumber,
            prTitle: pr.title,
            prUrl: pr.url,
            isReviewComment: true
          };
        });
        comments.push(...reviewComments);
      }
    } catch (error) {
      console.warn(`Failed to fetch review comments for PR #${prNumber}:`, error);
    }

    // Filter out comments that appear to be resolved based on reactions or replies
    // This is a simplification - GitHub doesn't have a built-in "resolved" state for comments
    // In practice, you might want to use heuristics or track resolved comments in your own storage

    return comments;
  }, `getUnresolvedComments(${repo}#${prNumber})`, 3); // 1 for PR details + 2 for comments
}

// Generate a prompt for Claude to address a comment
function generateCommentPrompt(comment: PRCommentWithContext): string {
  const contextInfo = comment.isReviewComment && comment.path
    ? `\n\nThis comment is on file: ${comment.path}${comment.line ? ` at line ${comment.line}` : ''}`
    : '';

  return `You are a helpful AI assistant responding to PR comments. You should:
1. Provide a thoughtful, professional response
2. If the comment requests code changes, suggest specific changes with code examples
3. If the comment is a question, provide a clear answer with context
4. Be concise but thorough
5. Use a friendly, collaborative tone

Repository: ${comment.repo}
PR: #${comment.prNumber} - ${comment.prTitle}
PR URL: ${comment.prUrl}
Comment Author: ${comment.user.login}
Comment Posted: ${comment.createdAt}${contextInfo}

Comment to address:
"${comment.body}"

Please provide a response that addresses this comment. If code changes are needed, provide specific suggestions or examples.`;
}

// Check if a comment should be addressed
function shouldAddressComment(comment: PRCommentWithContext, githubUsername?: string): boolean {
  // Skip if the comment is from the bot itself (if we know the username)
  if (githubUsername && comment.user.login === githubUsername) {
    return false;
  }

  // Skip very recent comments (less than 5 minutes old) to avoid responding too quickly
  const commentAge = Date.now() - new Date(comment.createdAt).getTime();
  if (commentAge < 5 * 60 * 1000) {
    return false;
  }

  // Skip if the comment body is too short or looks like an automated message
  if (comment.body.length < 10) {
    return false;
  }

  // Skip certain automated comments
  const skipPatterns = [
    /^\/lgtm/i,
    /^LGTM/,
    /^Approved/i,
    /^:shipit:/,
    /^Merging/i
  ];

  if (skipPatterns.some(pattern => pattern.test(comment.body))) {
    return false;
  }

  return true;
}

// Post a reply to a comment
async function postCommentReply(comment: PRCommentWithContext, reply: string): Promise<void> {
  return executeWithRateLimit(async () => {
    if (comment.isReviewComment) {
      // For review comments, we need to use the review comment reply API
      await exec(
        `gh api repos/${comment.repo}/pulls/${comment.prNumber}/comments/${comment.id}/replies -f body="${reply.replace(/"/g, '\\"')}"`
      );
    } else {
      // For issue comments, just post a new comment
      await exec(
        `gh api repos/${comment.repo}/issues/${comment.prNumber}/comments -f body="${reply.replace(/"/g, '\\"')}"`
      );
    }
  }, `postCommentReply(${comment.repo}#${comment.prNumber})`, 1);
}

// Process a single PR's comments
async function processPRComments(repo: string, prNumber: number, dryRun: boolean = false): Promise<{ addressed: number; skipped: number }> {
  try {
    console.log(`🔍 Checking PR ${repo}#${prNumber} for unresolved comments...`);

    const comments = await getUnresolvedComments(repo, prNumber);
    const settings = await getUserSettings();

    let addressed = 0;
    let skipped = 0;

    for (const comment of comments) {
      if (!shouldAddressComment(comment, settings.githubUsername)) {
        skipped++;
        continue;
      }

      console.log(`💬 Addressing comment from ${comment.user.login} on PR #${prNumber}`);

      // Generate response using Claude
      const prompt = generateCommentPrompt(comment);

      try {
        const { stdout: response } = await executeClaudeWithStdin(
          prompt,
          ['--dangerously-skip-permissions'],
          60000 // 1 minute timeout
        );

        if (!response || response.length < 10) {
          console.warn(`Skipping comment - insufficient response generated`);
          skipped++;
          continue;
        }

        if (!dryRun) {
          await postCommentReply(comment, response);
          console.log(`✅ Posted reply to comment on PR #${prNumber}`);
        } else {
          console.log(`🌟 [DRY RUN] Would post reply to comment on PR #${prNumber}`);
        }

        addressed++;

        // Rate limit ourselves - wait 2 seconds between comments
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Failed to address comment:`, error);
        skipped++;
      }
    }

    return { addressed, skipped };
  } catch (error) {
    console.error(`Failed to process PR ${repo}#${prNumber}:`, error);
    return { addressed: 0, skipped: 0 };
  }
}

// Main resolver function
export async function runPRCommentResolver(dryRun: boolean = false): Promise<void> {
  if (resolverState.isRunning) {
    console.log('⏭️  PR resolver already running, skipping this cycle');
    return;
  }

  try {
    resolverState.isRunning = true;
    console.log('🔄 PR Comment Resolver starting...');

    const settings = await getUserSettings();

    if (!settings.githubUsername) {
      console.log('⚠️  GitHub username not configured, skipping PR resolution');
      return;
    }

    const githubConfig = await getGitHubConfig();

    if (githubConfig.repos.length === 0) {
      console.log('📭 No repositories configured');
      return;
    }

    let totalAddressed = 0;
    let totalSkipped = 0;
    const processedPRs: string[] = [];

    // Process each configured repository
    for (const repoConfig of githubConfig.repos) {
      const repoName = typeof repoConfig === 'string' ? repoConfig : repoConfig.name;

      try {
        // Get open PRs for the repository
        const { stdout: prsData } = await exec(
          `gh pr list --repo ${repoName} --state open --json number,author --limit 30`
        );
        const prs = JSON.parse(prsData);

        console.log(`📋 Found ${prs.length} open PRs in ${repoName}`);

        // Filter to PRs by the configured user
        const userPRs = prs.filter((pr: any) => pr.author.login === settings.githubUsername);

        for (const pr of userPRs) {
          const result = await processPRComments(repoName, pr.number, dryRun);
          totalAddressed += result.addressed;
          totalSkipped += result.skipped;

          if (result.addressed > 0) {
            processedPRs.push(`${repoName}#${pr.number}`);
          }
        }

      } catch (error) {
        console.error(`Failed to process repository ${repoName}:`, error);
      }
    }

    // Update last run time
    if (!dryRun) {
      settings.prResolver = {
        ...settings.prResolver,
        lastRun: new Date().toISOString()
      };
      await saveUserSettings(settings);
    }

    // Generate summary report
    if (totalAddressed > 0 || processedPRs.length > 0) {
      const reportContent = `# PR Comment Resolution Report

**Date:** ${new Date().toISOString()}
**Mode:** ${dryRun ? 'Dry Run' : 'Live'}
**User:** ${settings.githubUsername}

## Summary

- **Comments Addressed:** ${totalAddressed}
- **Comments Skipped:** ${totalSkipped}
- **PRs Processed:** ${processedPRs.length}

## Processed PRs

${processedPRs.map(pr => `- ${pr}`).join('\n')}

## Notes

This report was automatically generated by the PR Comment Resolver.
`;

      await saveReport(
        `PR Comment Resolution Report - ${new Date().toISOString().split('T')[0]}`,
        reportContent,
        {
          summary: `Addressed ${totalAddressed} comments across ${processedPRs.length} PRs`,
          tags: ['pr-resolver', 'automated', dryRun ? 'dry-run' : 'live'],
        }
      );
    }

    console.log(`✅ PR resolver completed: ${totalAddressed} comments addressed, ${totalSkipped} skipped`);
    resolverState.lastTaskCount = totalAddressed;

  } catch (error) {
    console.error('❌ PR resolver failed:', error);
  } finally {
    resolverState.isRunning = false;
  }
}

// Start the PR comment resolver scheduler
export async function startPRResolver(): Promise<void> {
  const settings = await getUserSettings();

  if (!settings.prResolver?.enabled) {
    console.log('💤 PR resolver is disabled');
    return;
  }

  if (!settings.githubUsername) {
    console.log('⚠️  Cannot start PR resolver - GitHub username not configured');
    return;
  }

  // Stop existing job if running
  if (resolverCronJob) {
    resolverCronJob.stop();
  }

  const frequency = settings.prResolver.frequency || '0 */6 * * *'; // Default: every 6 hours

  resolverCronJob = cron.schedule(frequency, () => runPRCommentResolver(false), {
    scheduled: false
  });

  resolverCronJob.start();
  console.log(`🚀 PR resolver started with schedule: ${frequency}`);
}

// Stop the PR comment resolver
export function stopPRResolver(): void {
  if (resolverCronJob) {
    resolverCronJob.stop();
    resolverCronJob = null;
  }
  console.log('🛑 PR resolver stopped');
}

// Toggle PR resolver on/off
export async function togglePRResolver(enabled: boolean): Promise<void> {
  const settings = await getUserSettings();

  settings.prResolver = {
    ...settings.prResolver,
    enabled,
    frequency: settings.prResolver?.frequency || '0 */6 * * *'
  };

  await saveUserSettings(settings);

  if (enabled) {
    await startPRResolver();
  } else {
    stopPRResolver();
  }
}

// Update PR resolver frequency
export async function updatePRResolverFrequency(frequency: string): Promise<void> {
  if (!cron.validate(frequency)) {
    throw new Error('Invalid cron expression');
  }

  const settings = await getUserSettings();

  settings.prResolver = {
    ...settings.prResolver,
    enabled: settings.prResolver?.enabled || false,
    frequency
  };

  await saveUserSettings(settings);

  if (settings.prResolver.enabled) {
    await startPRResolver(); // Restart with new frequency
  }
}

// Get PR resolver status
export async function getPRResolverStatus(): Promise<{ enabled: boolean; isRunning: boolean; lastRun?: string; lastTaskCount?: number }> {
  const settings = await getUserSettings();
  return {
    enabled: settings.prResolver?.enabled || false,
    isRunning: resolverState.isRunning,
    lastRun: settings.prResolver?.lastRun,
    lastTaskCount: resolverState.lastTaskCount
  };
}