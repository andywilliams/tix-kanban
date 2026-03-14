// Document provider - index markdown files for context retrieval

import { DocumentProvider, DocumentData } from './types.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
// Common stop words - defined once at module level to avoid recreation on every extractKeywords call
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'but', 'not',
  'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'can',
  'could', 'should', 'would', 'may', 'might', 'must', 'shall',
]);

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
  private ready: Promise<void>;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(os.homedir(), '.tix-kanban', 'documents');
    this.ready = this.loadIndex();
  }

  /**
   * Wait for the provider to be ready (index loaded)
   */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Index markdown files from given paths
   */
  async index(paths: string[]): Promise<void> {
    await this.ready;
    const newDocs: DocumentData[] = [];
    
    for (const p of paths) {
      // Validate and sanitize path to prevent path traversal
      const validatedPath = this.validatePath(p);
      if (!validatedPath) {
        console.warn(`Path validation failed for: ${p}`);
        continue;
      }
      
      const docs = await this.indexPath(validatedPath);
      newDocs.push(...docs);
      this.indexedPaths.add(validatedPath);
    }

    // Use a Map to deduplicate AND preserve updated versions
    // Key: document ID, Value: document (last occurrence wins for updates)
    const docsMap = new Map<string, DocumentData>();
    
    // First, add existing documents (they may be updated by new docs with same ID)
    for (const doc of this.documentIndex.documents) {
      docsMap.set(doc.id, doc);
    }
    
    // Then, add/overwrite with new documents (updated versions replace old ones)
    for (const doc of newDocs) {
      docsMap.set(doc.id, doc);
    }
    
    // Convert back to array
    this.documentIndex.documents = Array.from(docsMap.values());
    
    // Rebuild TF-IDF index
    await this.buildTfidfIndex();
    
    // Persist index
    await this.saveIndex();
  }

  /**
   * Validate and sanitize a path to prevent path traversal attacks.
   * Returns the resolved absolute path if valid, or null if invalid.
   */
  private validatePath(inputPath: string): string | null {
    try {
      // Resolve to absolute path
      const resolved = path.resolve(inputPath);

      // Allow paths within the current working directory or common safe roots
      const cwd = process.cwd();
      const home = os.homedir();

      // Path must be within cwd (project root) or the user home directory
      // This prevents arbitrary reads like /etc/passwd
      const isWithinCwd = resolved.startsWith(cwd + path.sep) || resolved === cwd;
      const isWithinHome = resolved.startsWith(home + path.sep) || resolved === home;

      if (!isWithinCwd && !isWithinHome) {
        return null;
      }

      return resolved;
    } catch {
      return null;
    }
  }

  /**
   * Recursively index files from a path
   */
  private async indexPath(targetPath: string, visited: Set<string> = new Set()): Promise<DocumentData[]> {
    const docs: DocumentData[] = [];
    
    try {
      // Use lstat to detect symlinks without following them (prevents symlink cycles)
      const lstat = await fs.lstat(targetPath);
      if (lstat.isSymbolicLink()) {
        return docs;
      }

      const stat = lstat;
      
      if (stat.isDirectory()) {
        // Track real paths to detect hard-link cycles
        const realPath = await fs.realpath(targetPath);
        if (visited.has(realPath)) return docs;
        visited.add(realPath);

        // Recursively index directory
        const entries = await fs.readdir(targetPath);
        for (const entry of entries) {
          const fullPath = path.join(targetPath, entry);
          const subDocs = await this.indexPath(fullPath, visited);
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
    
    // Remove common stop words (using module-level constant)
    return tokens.filter(t => !STOP_WORDS.has(t));
  }

  /**
   * Build TF-IDF index from documents
   */
  private async buildTfidfIndex(target?: { documents: DocumentData[]; tfidf: Map<string, Map<string, number>>; idf: Map<string, number> }): Promise<void> {
    const idx = target ?? this.documentIndex;
    const { documents } = idx;
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
    
    // Calculate IDF (inverse document frequency) with smoothing
    const totalDocs = documents.length;
    const idf: Map<string, number> = new Map();
    for (const [term, df] of documentFrequency) {
      idf.set(term, Math.log((totalDocs + 1) / (df + 1)));
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
    
    idx.tfidf = tfidf;
    idx.idf = idf;
  }

  /**
   * Search for relevant documents using query
   */
  async search(query: string, limit: number = 5): Promise<DocumentData[]> {
    await this.ready;
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
    await this.ready;
    return this.documentIndex.documents;
  }

  /**
   * Re-index all previously indexed paths
   */
  async refresh(): Promise<void> {
    await this.ready;
    const paths = Array.from(this.indexedPaths);

    // Build the new index entirely in a temp object so concurrent search()/list()
    // calls keep reading from the current live index during the async rebuild.
    const newIndex = {
      documents: [] as DocumentData[],
      tfidf: new Map<string, Map<string, number>>(),
      idf: new Map<string, number>(),
    };
    const newPaths = new Set<string>();

    for (const p of paths) {
      const validatedPath = this.validatePath(p);
      if (!validatedPath) {
        console.warn(`Path validation failed during refresh for: ${p}`);
        continue;
      }
      const docs = await this.indexPath(validatedPath);
      newIndex.documents.push(...docs);
      newPaths.add(p);
    }

    // Deduplicate documents by ID using a Map (last occurrence wins for updates)
    // This ensures modified files are updated, not skipped
    const docsMap = new Map<string, DocumentData>();
    for (const doc of newIndex.documents) {
      docsMap.set(doc.id, doc); // Overwrites any existing doc with same ID
    }
    newIndex.documents = Array.from(docsMap.values());

    // Build TF-IDF on the temp index (doesn't touch the live index)
    await this.buildTfidfIndex(newIndex);

    // Atomic swap: concurrent readers now see the fully-built new index.
    // Stale paths (deleted/renamed since last index) are not carried over.
    this.documentIndex = newIndex;
    this.indexedPaths = newPaths;

    // Persist the new index to disk
    await this.saveIndex();
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
    // Wait for initial load to complete before indexing
    await this.ready;
    
    if (config.paths && Array.isArray(config.paths)) {
      await this.index(config.paths);
    }
  }
}

export const documentProvider = new LocalDocumentProvider();
