// Core provider interfaces

export interface TicketData {
  id: string;
  title: string;
  status: 'backlog' | 'in-progress' | 'review' | 'done';
  description?: string;
  priority?: number;
  assignee?: string;
  externalId?: string;  // e.g. Notion page ID, GitHub issue number
  externalUrl?: string; // e.g. Notion URL, GitHub issue URL
  lastUpdated?: string;
}

export interface TicketProvider {
  name: string;
  sync(): Promise<TicketData[]>;  // Pull tickets from external source
  push?(ticket: TicketData): Promise<void>;  // Optional: write updates back
  configure?(config: any): Promise<void>;  // Optional: runtime configuration
}

export interface MessageData {
  id: string;
  channel: string;
  author: string;
  text: string;
  timestamp: string;
  threadId?: string;
}

export interface MessageProvider {
  name: string;
  sync(): Promise<MessageData[]>;  // Pull messages from external source
  configure?(config: any): Promise<void>;
}

export interface DocumentData {
  id: string;
  path: string;
  title: string;
  content: string;
  lastModified: string;
  keywords?: string[];  // Extracted keywords for faster matching
}

export interface DocumentProvider {
  name: string;
  index(paths: string[]): Promise<void>;  // Index documents from paths
  search(query: string, limit?: number): Promise<DocumentData[]>;  // Search for relevant docs
  list(): Promise<DocumentData[]>;  // List all indexed documents
  refresh(): Promise<void>;  // Re-index all documents
  configure?(config: any): Promise<void>;
}

export interface ProviderConfig {
  ticketProvider?: string;  // 'tix' | 'file' | 'github-issues' | custom
  messageProvider?: string; // 'slx' | 'file' | custom
  documentProvider?: string; // 'document' | custom
  ticketProviderConfig?: any;
  messageProviderConfig?: any;
  documentProviderConfig?: {
    paths?: string[];  // Default paths to index (e.g., ['docs/', 'adrs/', 'runbooks/'])
    watchMode?: boolean;  // Auto-refresh on file changes
  };
}
