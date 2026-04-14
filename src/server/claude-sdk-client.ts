import { query } from '@anthropic-ai/claude-agent-sdk';

export interface SdkQueryOptions {
  prompt: string;
  timeoutMs?: number;
  maxTurns?: number;
  systemPrompt?: string;
}

export interface SdkQueryResult {
  text: string;
  error?: string;
  stoppedBy?: 'complete' | 'timeout' | 'error' | 'max_turns';
}

export async function runSdkQuery(opts: SdkQueryOptions): Promise<SdkQueryResult> {
  const { prompt, timeoutMs = 90000, maxTurns = 10, systemPrompt } = opts;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  const chunks: string[] = [];
  let stoppedBy: SdkQueryResult['stoppedBy'] = 'complete';
  let errorMsg: string | undefined;

  try {
    const q = query({
      prompt,
      options: {
        abortController: abort,
        maxTurns,
        ...(systemPrompt ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt } as any } : {}),
      },
    });

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const content = (msg as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              chunks.push(block.text);
            }
          }
        }
        if ((msg as any).error) {
          errorMsg = String((msg as any).error);
        }
      } else if (msg.type === 'result') {
        const sub = (msg as any).subtype;
        if (sub === 'error_max_turns') stoppedBy = 'max_turns';
        else if (sub && sub.startsWith('error')) stoppedBy = 'error';
        if ((msg as any).is_error && (msg as any).result) {
          errorMsg = String((msg as any).result);
        }
      }
    }
  } catch (err: any) {
    if (abort.signal.aborted) {
      stoppedBy = 'timeout';
      errorMsg = `SDK query timed out after ${timeoutMs}ms`;
    } else {
      stoppedBy = 'error';
      errorMsg = err?.message || String(err);
    }
  } finally {
    clearTimeout(timer);
  }

  return { text: chunks.join('').trim(), error: errorMsg, stoppedBy };
}
