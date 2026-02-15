export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'in-progress' | 'review' | 'done';
  priority: number;
  persona?: string; // Personas ARE the assignees - no separate assignee field
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  estimate?: string;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  author: string;
  createdAt: Date;
}

export interface Link {
  id: string;
  taskId: string;
  url: string;
  title: string;
  type: 'pr' | 'attachment' | 'reference';
}

export interface Persona {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
}

export interface Filter {
  tags?: string[];
  persona?: string;
  status?: Task['status'];
}