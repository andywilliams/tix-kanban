// Wrapper around existing notion-sync.ts

import { TicketProvider, TicketData } from './types.js';
import { 
  loadNotionConfig, 
  syncTasksFromNotion, 
  mapNotionStatusToKanban,
  NotionConfig 
} from '../notion-sync.js';

export class TixProvider implements TicketProvider {
  name = 'tix';
  private config: NotionConfig | null = null;

  async sync(): Promise<TicketData[]> {
    if (!this.config) {
      this.config = await loadNotionConfig();
    }
    
    if (!this.config || !this.config.syncEnabled) {
      return [];
    }

    const notionTasks = await syncTasksFromNotion(this.config);
    
    return notionTasks.map(task => ({
      id: task.id,
      title: task.title,
      status: mapNotionStatusToKanban(task.status, this.config!.statusMappings),
      description: task.description,
      priority: task.priority,
      assignee: task.assignee,
      externalId: task.notionId,
      externalUrl: task.url,
      lastUpdated: task.lastUpdated,
    }));
  }

  async configure(config: NotionConfig): Promise<void> {
    this.config = config;
  }
}

export const tixProvider = new TixProvider();
