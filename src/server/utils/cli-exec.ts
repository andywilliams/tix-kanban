import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';

const execFile = promisify(execFileCb);

export interface ExecProviderOptions {
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Execute a CLI provider command and parse JSON output
 * 
 * @param command - Command to execute (e.g., 'tix')
 * @param args - Arguments to pass to the command
 * @param opts - Execution options (timeout, environment variables)
 * @returns Parsed JSON output from the command
 * @throws Error if command fails or output is not valid JSON
 */
export async function execProvider<T>(
  command: string,
  args: string[],
  opts?: ExecProviderOptions
): Promise<T> {
  const timeoutMs = opts?.timeout ?? 30_000;
  try {
    const { stdout } = await execFile(command, args, {
      timeout: timeoutMs,
      env: { ...process.env, ...opts?.env },
      maxBuffer: 10 * 1024 * 1024, // 10MB max output
    });

    return JSON.parse(stdout);
  } catch (err: any) {
    const timedOut = err.killed === true && (err.code === 'ETIMEDOUT' || err.message?.includes('timed out'));
    if (timedOut) {
      throw new Error(`Command "${command} ${args.join(' ')}" timed out after ${timeoutMs}ms`);
    }
    if (err.killed === true && err.signal) {
      throw new Error(`Command "${command} ${args.join(' ')}" was killed by signal ${err.signal}`);
    }
    if (err.code === 'ENOENT') {
      throw new Error(`Command "${command}" not found. Ensure it is installed and in PATH.`);
    }
    if (err.stderr) {
      throw new Error(`Command failed: ${err.stderr}`);
    }
    throw new Error(`Failed to execute provider command: ${err.message}`);
  }
}
