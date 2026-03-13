// CLI-based ticket provider that shells out to `tix` command

import { TicketProvider, TicketData } from './types.js';
import { execProvider } from '../utils/cli-exec.js';

interface TixListOutput {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: number;
  assignee?: string;
  externalId?: string;
  externalUrl?: string;
  lastUpdated?: string;
}

/**
 * Base class for CLI-based ticket providers
 * Subclasses implement the specific CLI command and argument structure
 */
export abstract class CLITicketProvider implements TicketProvider {
  abstract name: string;
  
  /**
   * Get the command to execute (e.g., 'tix', 'gh')
   */
  protected abstract getCommand(): string;
  
  /**
   * Get the arguments to pass to the command (e.g., ['list', '--json'])
   */
  protected abstract getListArgs(): string[];
  
  /**
   * Transform CLI output to TicketData format
   * Override if the CLI output format differs from TicketData
   */
  protected transformTicket(ticket: any): TicketData {
    return {
      id: ticket.id,
      title: ticket.title,
      status: this.normalizeStatus(ticket.status),
      description: ticket.description,
      priority: ticket.priority,
      assignee: ticket.assignee,
      externalId: ticket.externalId,
      externalUrl: ticket.externalUrl,
      lastUpdated: ticket.lastUpdated,
    };
  }
  
  /**
   * Normalize status to one of the canonical kanban statuses
   */
  protected normalizeStatus(status: string | null | undefined): 'backlog' | 'in-progress' | 'review' | 'done' {
    if (!status) {
      console.warn(`Missing status, defaulting to backlog`);
      return 'backlog';
    }
    const lower = status.toLowerCase();
    
    if (lower.includes('backlog') || lower.includes('todo') || lower.includes('new')) {
      return 'backlog';
    }
    if (lower.includes('progress') || lower.includes('doing') || lower.includes('active')) {
      return 'in-progress';
    }
    if (lower.includes('review') || lower.includes('testing') || lower.includes('pending')) {
      return 'review';
    }
    if (lower.includes('done') || lower.includes('complete') || lower.includes('closed')) {
      return 'done';
    }
    
    // Default to backlog for unknown statuses
    console.warn(`Unknown status "${status}", defaulting to backlog`);
    return 'backlog';
  }
  
  async sync(): Promise<TicketData[]> {
    try {
      const command = this.getCommand();
      const args = this.getListArgs();
      
      const tickets = await execProvider<TixListOutput[]>(command, args, {
        timeout: 30_000,
      });
      
      return tickets.map(ticket => this.transformTicket(ticket));
    } catch (err: any) {
      console.error(`Failed to sync tickets from ${this.name}:`, err.message);
      return [];
    }
  }
}

/**
 * Tix CLI provider - syncs tickets from Notion via `tix list --json`
 */
export class TixProvider extends CLITicketProvider {
  name = 'tix';
  
  protected getCommand(): string {
    return 'tix';
  }
  
  protected getListArgs(): string[] {
    return ['list', '--json'];
  }
}

export const tixProvider = new TixProvider();
