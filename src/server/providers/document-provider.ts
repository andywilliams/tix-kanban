// Document provider - index markdown files for context retrieval

import { DocumentProvider, DocumentData } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';

interface DocumentIndex {
  documents: DocumentData[];
  tfidf: Map<string, Map<string, number>>;  // term -> docId -> tf-idf score
  idf: Map<string, number>;  // term -> inverse document frequency
}

export class LocalDocumentProvider implements DocumentProvider {
  name = 'document';
  private documentIndex: DocumentIndex = {
    documents: [],
    tfidf: new Map(),
    idf: new Map(),
  };
  private indexedPaths: Set<string> = new Set();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.cwd(), '.tix-kanban', 'documents');
  }

  /**
   * Index markdown files from given paths
   */
  async index(paths: string[]): Promise<void> {
    const newDocs: DocumentData[] = [];
    
    for (const p of paths) {
      const docs = await this.indexPath(p);
      newDocs.push(...docs);
      this.indexedPaths.add(p);
    }

    // Add to existing documents
    this.documentIndex.documents.push(...newDocs);
    
    // Rebuild TF-IDF index
    await this.buildTfidfIndex();
    
    // Persist index
    await this.saveIndex();
  }

  /**
   * Recursively index files from a path
   */
  private async indexPath(targetPath: string): Promise<DocumentData[]> {
    const docs: DocumentData[] = [];
    
    try {
      const stat = await fs.stat(targetPath);
      
      if (stat.isDirectory()) {
        // Recursively index directory
        const entries = await fs.readdir(targetPath);
        for (const entry of entries) {
          const fullPath = path.join(targetPath, entry);
          const subDocs = await this.indexPath(fullPath);
          docs.push(...subDocs);
        }
      } else if (stat.isFile() && targetPath.endsWith('.md')) {
        // Index markdown file
        const doc = await this.indexFile(targetPath);
        if (doc) docs.push(doc);
      }
    } catch (err: any) {
      console.error(`Error indexing ${targetPath}:`, err.message);
    }
    
    return docs;
  }

  /**
   * Index a single markdown file
   */
  private async indexFile(filePath: string): Promise<DocumentData | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const { data: frontmatter, content: body } = matter(content);
      
      // Extract title from frontmatter or first heading
      let title = frontmatter.title || '';
      if (!title) {
        const headingMatch = body.match(/^#\s+(.+)$/m);
        title = headingMatch ? headingMatch[1] : path.basename(filePath, '.md');
      }

      // Generate deterministic ID from file path
      const id = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16);
      
      const stat = await fs.stat(filePath);
      
      return {
        id,
        path: filePath,
        title,
        content: body,
        lastModified: stat.mtime.toISOString(),
        keywords: this.extractKeywords(title + ' ' + body),
      };
    } catch (err: any) {
      console.error(`Error reading file ${filePath}:`, err.message);
      return null;
    }
  }

  /**
   * Extract keywords from text (simple tokenization)
   */
  private extractKeywords(text: string): string[] {
    // Lowercase, remove punctuation, split on whitespace
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);  // Filter short words
    
    // Remove common stop words
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'but', 'not',
      'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'can',
      'could', 'should', 'would', 'may', 'might', 'must', 'shall',
    ]);
    
    return tokens.filter(t => !stopWords.has(t));
  }

  /**
   * Build TF-IDF index from documents
   */
  private async buildTfidfIndex(): Promise<void> {
    const { documents } = this.documentIndex;
    const termFrequency: Map<string, Map<string, number>> = new Map();
    const documentFrequency: Map<string, number> = new Map();
    
    // Calculate term frequency (TF) for each document
    for (const doc of documents) {
      const terms = doc.keywords || [];
      const termCounts: Map<string, number> = new Map();
      
      for (const term of terms) {
        termCounts.set(term, (termCounts.get(term) || 0) + 1);
      }
      
      // Normalize TF (divide by total terms in doc)
      const totalTerms = terms.length;
      for (const [term, count] of termCounts) {
        if (!termFrequency.has(term)) {
          termFrequency.set(term, new Map());
        }
        termFrequency.get(term)!.set(doc.id, count / totalTerms);
        
        // Track document frequency
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }
    
    // Calculate IDF (inverse document frequency)
    const totalDocs = documents.length;
    const idf: Map<string, number> = new Map();
    for (const [term, df] of documentFrequency) {
      idf.set(term, Math.log(totalDocs / df));
    }
    
    // Calculate TF-IDF scores
    const tfidf: Map<string, Map<string, number>> = new Map();
    for (const [term, docTfs] of termFrequency) {
      const idfScore = idf.get(term) || 0;
      const scores: Map<string, number> = new Map();
      
      for (const [docId, tf] of docTfs) {
        scores.set(docId, tf * idfScore);
      }
      
      tfidf.set(term, scores);
    }
    
    this.documentIndex.tfidf = tfidf;
    this.documentIndex.idf = idf;
  }

  /**
   * Search for relevant documents using query
   */
  async search(query: string, limit: number = 5): Promise<DocumentData[]> {
    const queryTerms = this.extractKeywords(query);
    const scores: Map<string, number> = new Map();
    
    // Calculate relevance score for each document
    for (const term of queryTerms) {
      const docScores = this.documentIndex.tfidf.get(term);
      if (!docScores) continue;
      
      for (const [docId, score] of docScores) {
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }
    
    // Sort by score and return top N
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    
    return sorted
      .map(([docId, _]) => this.documentIndex.documents.find(d => d.id === docId))
      .filter((d): d is DocumentData => d !== undefined);
  }

  /**
   * List all indexed documents
   */
  async list(): Promise<DocumentData[]> {
    return this.documentIndex.documents;
  }

  /**
   * Re-index all previously indexed paths
   */
  async refresh(): Promise<void> {
    const paths = Array.from(this.indexedPaths);
    this.documentIndex = {
      documents: [],
      tfidf: new Map(),
      idf: new Map(),
    };
    
    await this.index(paths);
  }

  /**
   * Save index to disk
   */
  private async saveIndex(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      
      const indexData = {
        documents: this.documentIndex.documents,
        indexedPaths: Array.from(this.indexedPaths),
      };
      
      const indexPath = path.join(this.dataDir, 'index.json');
      await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    } catch (err: any) {
      console.error('Error saving document index:', err.message);
    }
  }

  /**
   * Load index from disk
   */
  async loadIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.dataDir, 'index.json');
      const data = await fs.readFile(indexPath, 'utf8');
      const indexData = JSON.parse(data);
      
      this.documentIndex.documents = indexData.documents || [];
      this.indexedPaths = new Set(indexData.indexedPaths || []);
      
      // Rebuild TF-IDF from loaded documents
      await this.buildTfidfIndex();
    } catch (err: any) {
      // No saved index - start fresh
      this.documentIndex = {
        documents: [],
        tfidf: new Map(),
        idf: new Map(),
      };
      this.indexedPaths = new Set();
    }
  }

  /**
   * Configure the provider
   */
  async configure(config: any): Promise<void> {
    if (config.paths && Array.isArray(config.paths)) {
      await this.index(config.paths);
    }
  }
}

export const documentProvider = new LocalDocumentProvider();

// Load existing index on initialization
documentProvider.loadIndex().catch(err => {
  console.error('Error loading document index:', err.message);
});
