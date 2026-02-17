import { Client } from '@notionhq/client';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface NotionConfig {
  apiKey: string;
  databaseId: string;
  userName: string;
  statusMappings: {
    [notionStatus: string]: 'backlog' | 'in-progress' | 'review' | 'done';
  };
  syncEnabled: boolean;
}

export interface NotionTask {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: number;
  assignee?: string;
  lastUpdated: string;
  url: string;
  notionId: string;
}

const NOTION_CONFIG_FILE = path.join(os.homedir(), '.tix-kanban', 'notion-config.json');

/**
 * Load Notion configuration
 */
export async function loadNotionConfig(): Promise<NotionConfig | null> {
  try {
    const configData = await fs.readFile(NOTION_CONFIG_FILE, 'utf-8');
    return JSON.parse(configData);
  } catch {
    return null;
  }
}

/**
 * Save Notion configuration
 */
export async function saveNotionConfig(config: NotionConfig): Promise<void> {
  const configDir = path.dirname(NOTION_CONFIG_FILE);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(NOTION_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Extract property value from Notion page
 */
function extractPropertyValue(prop: any): string {
  if (!prop) return '';

  switch (prop.type) {
    case 'title':
      return prop.title?.map((t: any) => t.plain_text).join('') || '';
    case 'rich_text':
      return prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
    case 'select':
      return prop.select?.name || '';
    case 'status':
      return prop.status?.name || '';
    case 'number':
      return prop.number?.toString() || '';
    case 'people':
      return prop.people?.map((p: any) => p.name || p.id).join(', ') || '';
    case 'date':
      return prop.date?.start || '';
    default:
      return '';
  }
}

/**
 * Find a property by common names (case-insensitive)
 */
function findProperty(properties: Record<string, any>, candidates: string[]): string {
  const keys = Object.keys(properties);
  for (const candidate of candidates) {
    const found = keys.find(k => k.toLowerCase() === candidate.toLowerCase());
    if (found) return extractPropertyValue(properties[found]);
  }
  return '';
}

/**
 * Find the title property name
 */
function findTitleProperty(properties: Record<string, any>): string {
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === 'title') return name;
  }
  return 'Name';
}

/**
 * Convert priority text to number
 */
function convertPriorityToNumber(priority: string): number {
  const lowerPriority = priority.toLowerCase();
  if (lowerPriority.includes('urgent') || lowerPriority.includes('high')) return 200;
  if (lowerPriority.includes('medium') || lowerPriority.includes('normal')) return 150;
  if (lowerPriority.includes('low')) return 100;
  return 100; // default
}

/**
 * Sync tasks from Notion database
 */
export async function syncTasksFromNotion(config: NotionConfig): Promise<NotionTask[]> {
  const notion = new Client({ auth: config.apiKey });

  try {
    const response = await (notion.databases as any).query({
      database_id: config.databaseId,
      page_size: 100,
    });

    const tasks: NotionTask[] = [];
    const userName = config.userName.toLowerCase();

    for (const page of response.results) {
      if (page.object !== 'page') continue;

      const props = (page as any).properties || {};
      
      // Check if assigned to user
      const assignee = findProperty(props, [
        'Assigned to', 'Assignee', 'Assigned', 'Owner', 'Person', 'People'
      ]).toLowerCase();

      // Only include tasks assigned to the configured user
      if (assignee && !assignee.includes(userName)) continue;

      const titleProp = findTitleProperty(props);
      const title = extractPropertyValue(props[titleProp]);
      const status = findProperty(props, ['Status', 'State', 'Stage']);
      const description = findProperty(props, ['Description', 'Details', 'Notes']);
      const priorityText = findProperty(props, ['Priority', 'Importance', 'Urgency', 'P']);
      const priority = convertPriorityToNumber(priorityText);
      
      const pageId = (page as any).id;
      const url = (page as any).url || `https://notion.so/${pageId.replace(/-/g, '')}`;
      const lastUpdated = (page as any).last_edited_time || new Date().toISOString();

      // Skip if no title or empty
      if (!title || title.trim() === '') continue;

      tasks.push({
        id: `notion-${pageId}`, // Prefix to avoid conflicts with local tasks
        title: title.trim(),
        status,
        description: description || undefined,
        priority,
        assignee: config.userName,
        lastUpdated,
        url,
        notionId: pageId,
      });
    }

    return tasks;
  } catch (err: any) {
    throw new Error(`Failed to sync from Notion: ${err.message}`);
  }
}

/**
 * Convert Notion status to kanban status using mappings
 */
export function mapNotionStatusToKanban(
  notionStatus: string, 
  mappings: NotionConfig['statusMappings']
): 'backlog' | 'in-progress' | 'review' | 'done' {
  const lowerStatus = notionStatus.toLowerCase();
  
  // Check exact mapping first
  for (const [key, value] of Object.entries(mappings)) {
    if (key.toLowerCase() === lowerStatus) {
      return value;
    }
  }

  // Default mappings if no custom mapping found
  if (lowerStatus.includes('todo') || lowerStatus.includes('backlog') || lowerStatus.includes('new')) {
    return 'backlog';
  }
  if (lowerStatus.includes('progress') || lowerStatus.includes('doing') || lowerStatus.includes('active')) {
    return 'in-progress';
  }
  if (lowerStatus.includes('review') || lowerStatus.includes('testing') || lowerStatus.includes('pending')) {
    return 'review';
  }
  if (lowerStatus.includes('done') || lowerStatus.includes('complete') || lowerStatus.includes('closed')) {
    return 'done';
  }

  // Default to backlog
  return 'backlog';
}

/**
 * Get default status mappings for common Notion statuses
 */
export function getDefaultStatusMappings(): NotionConfig['statusMappings'] {
  return {
    'To Do': 'backlog',
    'Not started': 'backlog',
    'Backlog': 'backlog',
    'New': 'backlog',
    'In Progress': 'in-progress',
    'Doing': 'in-progress',
    'Active': 'in-progress',
    'Working on it': 'in-progress',
    'Review': 'review',
    'Testing': 'review',
    'Pending': 'review',
    'Ready for review': 'review',
    'Done': 'done',
    'Complete': 'done',
    'Completed': 'done',
    'Shipped': 'done',
    'Closed': 'done',
  };
}