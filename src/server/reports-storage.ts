import path from 'path';
import { promises as fs } from 'fs';
import matter from 'gray-matter';

// Reports directory in user's home
const REPORTS_DIR = path.join(process.env.HOME || process.cwd(), '.tix-kanban', 'reports');

export interface Report {
  id: string; // filename without extension
  title: string;
  content: string;
  summary?: string;
  tags: string[];
  taskId?: string; // Link back to originating task
  createdAt: Date;
  updatedAt: Date;
  filename: string; // full filename with extension
}

export interface ReportMetadata {
  id: string;
  title: string;
  summary?: string;
  tags: string[];
  taskId?: string;
  createdAt: Date;
  updatedAt: Date;
  filename: string;
}

export async function initializeReportsStorage(): Promise<void> {
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    console.log(`Reports directory initialized: ${REPORTS_DIR}`);
  } catch (error) {
    console.error('Failed to initialize reports storage:', error);
    throw error;
  }
}

export async function saveReport(
  title: string, 
  content: string, 
  options: {
    summary?: string;
    tags?: string[];
    taskId?: string;
    slug?: string;
  } = {}
): Promise<Report> {
  try {
    await initializeReportsStorage();
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const slug = options.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${dateStr}-${slug}.md`;
    const id = filename.replace('.md', '');
    
    // Create frontmatter
    const frontmatter = {
      title,
      summary: options.summary || '',
      tags: options.tags || [],
      taskId: options.taskId || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    
    // Generate markdown with frontmatter
    const fileContent = matter.stringify(content, frontmatter);
    
    // Write to file
    const filePath = path.join(REPORTS_DIR, filename);
    await fs.writeFile(filePath, fileContent, 'utf8');
    
    return {
      id,
      title,
      content,
      summary: options.summary,
      tags: options.tags || [],
      taskId: options.taskId,
      createdAt: now,
      updatedAt: now,
      filename
    };
  } catch (error) {
    console.error('Failed to save report:', error);
    throw error;
  }
}

export async function getAllReports(): Promise<ReportMetadata[]> {
  try {
    await initializeReportsStorage();
    
    const files = await fs.readdir(REPORTS_DIR);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    const reports: ReportMetadata[] = [];
    
    for (const filename of markdownFiles) {
      try {
        const filePath = path.join(REPORTS_DIR, filename);
        const fileContent = await fs.readFile(filePath, 'utf8');
        const parsed = matter(fileContent);
        
        const id = filename.replace('.md', '');
        const stats = await fs.stat(filePath);
        
        reports.push({
          id,
          title: parsed.data.title || filename,
          summary: parsed.data.summary || '',
          tags: parsed.data.tags || [],
          taskId: parsed.data.taskId || undefined,
          createdAt: parsed.data.createdAt ? new Date(parsed.data.createdAt) : stats.birthtime,
          updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : stats.mtime,
          filename
        });
      } catch (error) {
        console.error(`Failed to parse report ${filename}:`, error);
        // Skip malformed files
      }
    }
    
    // Sort by creation date, newest first
    reports.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return reports;
  } catch (error) {
    console.error('Failed to get all reports:', error);
    throw error;
  }
}

export async function getReport(id: string): Promise<Report | null> {
  try {
    await initializeReportsStorage();
    
    const filename = id.endsWith('.md') ? id : `${id}.md`;
    const filePath = path.join(REPORTS_DIR, filename);
    
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = matter(fileContent);
      const stats = await fs.stat(filePath);
      
      return {
        id: filename.replace('.md', ''),
        title: parsed.data.title || filename,
        content: parsed.content,
        summary: parsed.data.summary || '',
        tags: parsed.data.tags || [],
        taskId: parsed.data.taskId || undefined,
        createdAt: parsed.data.createdAt ? new Date(parsed.data.createdAt) : stats.birthtime,
        updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : stats.mtime,
        filename
      };
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Failed to get report ${id}:`, error);
    throw error;
  }
}

export async function deleteReport(id: string): Promise<boolean> {
  try {
    await initializeReportsStorage();
    
    const filename = id.endsWith('.md') ? id : `${id}.md`;
    const filePath = path.join(REPORTS_DIR, filename);
    
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      return false;
    }
    console.error(`Failed to delete report ${id}:`, error);
    throw error;
  }
}

export function getReportsDirectory(): string {
  return REPORTS_DIR;
}