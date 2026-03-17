import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MemoryEntry } from '../persona-memory.js';
import {
  semanticSearch,
  hybridSearch,
  smartSearch,
} from './semanticSearch.js';
import { storeEmbedding, generateEmbedding } from './embeddings.js';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: class OpenAI {
      embeddings = {
        create: vi.fn(async ({ input }: { input: string }) => {
          // Return a mock embedding that varies based on content
          // Use a simple hash to generate consistent but different vectors
          const hash = input.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const mockEmbedding = Array(384).fill(0).map((_, i) => 
            Math.sin((hash + i) * 0.1) / 10
          );
          return {
            data: [{ embedding: mockEmbedding }]
          };
        })
      };
    }
  };
});

describe('Semantic Search', () => {
  const testPersonaId = 'test-persona-search';
  
  const testEntries: MemoryEntry[] = [
    {
      id: 'entry-1',
      category: 'instruction',
      content: 'Always use TypeScript for type safety',
      source: 'user',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      tags: ['typescript', 'coding'],
      importance: 'high',
    },
    {
      id: 'entry-2',
      category: 'preference',
      content: 'I prefer functional programming patterns',
      source: 'user',
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
      tags: ['coding-style', 'functional'],
      importance: 'medium',
    },
    {
      id: 'entry-3',
      category: 'context',
      content: 'Working on a React frontend project',
      source: 'user',
      createdAt: new Date('2024-01-03'),
      updatedAt: new Date('2024-01-03'),
      tags: ['react', 'frontend'],
      importance: 'medium',
    },
    {
      id: 'entry-4',
      category: 'learning',
      content: 'Learned that async/await is clearer than promises for this team',
      source: 'self',
      createdAt: new Date('2024-01-04'),
      updatedAt: new Date('2024-01-04'),
      tags: ['async', 'team-preference'],
      importance: 'low',
    },
  ];

  const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
  const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');
  const testPersonaDir = path.join(PERSONAS_DIR, testPersonaId);

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    
    // Clean up test data before each test
    try {
      await fs.rm(testPersonaDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
    
    // Generate and store embeddings for test entries
    for (const entry of testEntries) {
      const embedding = await generateEmbedding(entry.content);
      if (embedding) {
        await storeEmbedding(testPersonaId, entry.id, embedding);
      }
    }
  });
  
  afterEach(async () => {
    // Clean up test data after each test
    try {
      await fs.rm(testPersonaDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  it('should perform semantic search and return relevant results', async () => {
    const results = await semanticSearch(
      testPersonaId,
      'How should I write code?',
      testEntries,
      { topK: 3, minSimilarity: -1 } // Allow all results for mock embeddings
    );
    
    // With mock embeddings, we should get results
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0]).toHaveProperty('entry');
    expect(results[0]).toHaveProperty('score');
    expect(results[0].score).toBeGreaterThanOrEqual(-1);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });

  it('should filter by minimum similarity threshold', async () => {
    const results = await semanticSearch(
      testPersonaId,
      'TypeScript usage',
      testEntries,
      { topK: 10, minSimilarity: 0.8 }
    );
    
    // With high threshold, we might get fewer or no results
    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('should perform hybrid search combining semantic and keyword', async () => {
    const results = await hybridSearch(
      testPersonaId,
      'TypeScript coding preferences',
      testEntries,
      { topK: 3 }
    );
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    
    // Should include entries matching either semantically or by keyword
    const entryIds = results.map(r => r.entry.id);
    expect(entryIds).toContain('entry-1'); // TypeScript mention
  });

  it('should weight semantic vs keyword appropriately in hybrid search', async () => {
    const semanticHeavy = await hybridSearch(
      testPersonaId,
      'programming paradigms',
      testEntries,
      { topK: 3, semanticWeight: 0.9 }
    );
    
    const keywordHeavy = await hybridSearch(
      testPersonaId,
      'programming paradigms',
      testEntries,
      { topK: 3, semanticWeight: 0.1 }
    );
    
    expect(semanticHeavy.length).toBeGreaterThan(0);
    expect(keywordHeavy.length).toBeGreaterThan(0);
    // Results might differ based on weighting
  });

  it('should use smart search with automatic fallback', async () => {
    const results = await smartSearch(
      testPersonaId,
      'React development',
      testEntries,
      { topK: 3 }
    );
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    
    // Should find the React entry
    const entryIds = results.map(r => r.entry.id);
    expect(entryIds).toContain('entry-3');
  });

  it('should fallback to keyword search when embeddings fail', async () => {
    // Remove API key to force fallback
    delete process.env.OPENAI_API_KEY;
    
    const results = await smartSearch(
      testPersonaId,
      'TypeScript',
      testEntries,
      { topK: 3 }
    );
    
    expect(results.length).toBeGreaterThan(0);
    const entryIds = results.map(r => r.entry.id);
    expect(entryIds).toContain('entry-1'); // Should still find TypeScript entry
    
    // Restore for other tests
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('should return entries sorted by score', async () => {
    const results = await semanticSearch(
      testPersonaId,
      'coding best practices',
      testEntries,
      { topK: 10, minSimilarity: -1 }
    );
    
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });
});
