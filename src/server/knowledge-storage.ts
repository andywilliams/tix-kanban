import path from 'path';
import { promises as fs } from 'fs';
import matter from 'gray-matter';

// Knowledge directory in user's home
const KNOWLEDGE_DIR = path.join(process.env.HOME || process.cwd(), '.tix-kanban', 'knowledge');

export interface KnowledgeDoc {
  id: string; // filename without extension
  title: string;
  content: string;
  description?: string;
  repo?: string; // Which repo this knowledge applies to
  area: 'frontend' | 'backend' | 'API' | 'infra' | 'general'; // Knowledge area
  topic: string; // Main topic (e.g. "authentication", "database", "deployment")
  tags: string[]; // Additional searchable tags
  createdAt: Date;
  updatedAt: Date;
  lastVerified?: Date; // When this knowledge was last verified as current
  filename: string; // full filename with extension
}

export interface KnowledgeMetadata {
  id: string;
  title: string;
  description?: string;
  repo?: string;
  area: 'frontend' | 'backend' | 'API' | 'infra' | 'general';
  topic: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  lastVerified?: Date;
  filename: string;
}

export interface KnowledgeSearchResult {
  doc: KnowledgeMetadata;
  score: number; // Relevance score (simple keyword matching for now)
}

export async function initializeKnowledgeStorage(): Promise<void> {
  try {
    await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
    console.log(`Knowledge directory initialized: ${KNOWLEDGE_DIR}`);
  } catch (error) {
    console.error('Failed to initialize knowledge storage:', error);
    throw error;
  }
}

export async function saveKnowledgeDoc(
  title: string,
  content: string,
  options: {
    description?: string;
    repo?: string;
    area: 'frontend' | 'backend' | 'API' | 'infra' | 'general';
    topic: string;
    tags?: string[];
    slug?: string;
    id?: string; // For updates
  }
): Promise<KnowledgeDoc> {
  try {
    await initializeKnowledgeStorage();
    
    const now = new Date();
    let filename: string;
    let id: string;
    
    if (options.id) {
      // Updating existing doc
      id = options.id;
      filename = id.endsWith('.md') ? id : `${id}.md`;
    } else {
      // Creating new doc
      const slug = options.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const repoPrefix = options.repo ? `${options.repo.replace('/', '-')}-` : '';
      filename = `${repoPrefix}${options.area}-${slug}.md`;
      id = filename.replace('.md', '');
    }
    
    // Try to read existing doc for created date
    let createdAt = now;
    try {
      const existing = await getKnowledgeDoc(id);
      if (existing) {
        createdAt = existing.createdAt;
      }
    } catch {
      // New doc
    }
    
    // Create frontmatter
    const frontmatter = {
      title,
      description: options.description || '',
      repo: options.repo || null,
      area: options.area,
      topic: options.topic,
      tags: options.tags || [],
      createdAt: createdAt.toISOString(),
      updatedAt: now.toISOString(),
      lastVerified: now.toISOString()
    };
    
    // Generate markdown with frontmatter
    const fileContent = matter.stringify(content, frontmatter);
    
    // Write to file
    const filePath = path.join(KNOWLEDGE_DIR, filename);
    await fs.writeFile(filePath, fileContent, 'utf8');
    
    return {
      id,
      title,
      content,
      description: options.description,
      repo: options.repo,
      area: options.area,
      topic: options.topic,
      tags: options.tags || [],
      createdAt,
      updatedAt: now,
      lastVerified: now,
      filename
    };
  } catch (error) {
    console.error('Failed to save knowledge doc:', error);
    throw error;
  }
}

export async function getAllKnowledgeDocs(): Promise<KnowledgeMetadata[]> {
  try {
    await initializeKnowledgeStorage();
    
    const files = await fs.readdir(KNOWLEDGE_DIR);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    const docs: KnowledgeMetadata[] = [];
    
    for (const filename of markdownFiles) {
      try {
        const filePath = path.join(KNOWLEDGE_DIR, filename);
        const fileContent = await fs.readFile(filePath, 'utf8');
        const parsed = matter(fileContent);
        
        const id = filename.replace('.md', '');
        const stats = await fs.stat(filePath);
        
        docs.push({
          id,
          title: parsed.data.title || filename,
          description: parsed.data.description || '',
          repo: parsed.data.repo || undefined,
          area: parsed.data.area || 'general',
          topic: parsed.data.topic || '',
          tags: parsed.data.tags || [],
          createdAt: parsed.data.createdAt ? new Date(parsed.data.createdAt) : stats.birthtime,
          updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : stats.mtime,
          lastVerified: parsed.data.lastVerified ? new Date(parsed.data.lastVerified) : undefined,
          filename
        });
      } catch (error) {
        console.error(`Failed to parse knowledge doc ${filename}:`, error);
        // Skip malformed files
      }
    }
    
    // Sort by creation date, newest first
    docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return docs;
  } catch (error) {
    console.error('Failed to get all knowledge docs:', error);
    throw error;
  }
}

export async function getKnowledgeDoc(id: string): Promise<KnowledgeDoc | null> {
  try {
    await initializeKnowledgeStorage();
    
    const filename = id.endsWith('.md') ? id : `${id}.md`;
    const filePath = path.join(KNOWLEDGE_DIR, filename);
    
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = matter(fileContent);
      const stats = await fs.stat(filePath);
      
      return {
        id: filename.replace('.md', ''),
        title: parsed.data.title || filename,
        content: parsed.content,
        description: parsed.data.description || '',
        repo: parsed.data.repo || undefined,
        area: parsed.data.area || 'general',
        topic: parsed.data.topic || '',
        tags: parsed.data.tags || [],
        createdAt: parsed.data.createdAt ? new Date(parsed.data.createdAt) : stats.birthtime,
        updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : stats.mtime,
        lastVerified: parsed.data.lastVerified ? new Date(parsed.data.lastVerified) : undefined,
        filename
      };
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Failed to get knowledge doc ${id}:`, error);
    throw error;
  }
}

export async function deleteKnowledgeDoc(id: string): Promise<boolean> {
  try {
    await initializeKnowledgeStorage();
    
    const filename = id.endsWith('.md') ? id : `${id}.md`;
    const filePath = path.join(KNOWLEDGE_DIR, filename);
    
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      return false;
    }
    console.error(`Failed to delete knowledge doc ${id}:`, error);
    throw error;
  }
}

export async function searchKnowledgeDocs(query: {
  keywords?: string;
  repo?: string;
  area?: string;
  tags?: string[];
  limit?: number;
}): Promise<KnowledgeSearchResult[]> {
  try {
    const allDocs = await getAllKnowledgeDocs();
    const results: KnowledgeSearchResult[] = [];
    
    for (const doc of allDocs) {
      let score = 0;
      
      // Exact repo match gets high score
      if (query.repo && doc.repo === query.repo) {
        score += 50;
      }
      
      // Area match
      if (query.area && doc.area === query.area) {
        score += 30;
      }
      
      // Tag matches
      if (query.tags) {
        const matchingTags = query.tags.filter(tag => doc.tags.includes(tag));
        score += matchingTags.length * 20;
      }
      
      // Keyword matching in title, topic, description, tags
      if (query.keywords) {
        const keywords = query.keywords.toLowerCase().split(/\s+/);
        const searchableText = [
          doc.title,
          doc.topic,
          doc.description || '',
          ...doc.tags
        ].join(' ').toLowerCase();
        
        for (const keyword of keywords) {
          if (searchableText.includes(keyword)) {
            // Title matches get higher score
            if (doc.title.toLowerCase().includes(keyword)) {
              score += 15;
            } else if (doc.topic.toLowerCase().includes(keyword)) {
              score += 10;
            } else {
              score += 5;
            }
          }
        }
      }
      
      // Only include docs with some relevance
      if (score > 0) {
        results.push({ doc, score });
      }
    }
    
    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);
    
    // Apply limit
    if (query.limit && query.limit > 0) {
      return results.slice(0, query.limit);
    }
    
    return results;
  } catch (error) {
    console.error('Failed to search knowledge docs:', error);
    throw error;
  }
}

export function getKnowledgeDirectory(): string {
  return KNOWLEDGE_DIR;
}