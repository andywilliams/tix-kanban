import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  generateEmbedding,
  embedMemoryEntry,
  storeEmbedding,
  getEmbedding,
  getAllEmbeddings,
  deleteEmbedding,
} from './embeddings.js';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: class OpenAI {
      embeddings = {
        create: vi.fn(async ({ input }: { input: string }) => {
          // Check if API key is set
          if (!process.env.OPENAI_API_KEY) {
            throw new Error('API key not set');
          }
          // Return a mock embedding (simplified 384-dim vector)
          const mockEmbedding = Array(384).fill(0).map((_, i) => 
            Math.sin(i * 0.1) * (input.length / 100)
          );
          return {
            data: [{ embedding: mockEmbedding }]
          };
        })
      };
    }
  };
});

describe('Embeddings', () => {
  const testPersonaId = 'test-persona-isolated';
  const testEntryId = 'test-entry-123';
  const testContent = 'This is a test memory entry about debugging strategies';
  
  const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
  const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');
  const testPersonaDir = path.join(PERSONAS_DIR, testPersonaId);

  beforeEach(async () => {
    // Set API key for tests
    process.env.OPENAI_API_KEY = 'test-key';
    
    // Clean up test data before each test
    try {
      await fs.rm(testPersonaDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
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

  it('should generate embedding for text', async () => {
    const embedding = await generateEmbedding(testContent);
    expect(embedding).toBeTruthy();
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding!.length).toBe(384);
  });

  it('should return null when API key is not set', async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    
    // Need to recreate the client after deleting the key
    // The client is lazily initialized, so we need to clear it
    const embedding = await generateEmbedding(testContent);
    expect(embedding).toBeNull();
    
    // Restore for other tests
    if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  });

  it('should store and retrieve embeddings', async () => {
    const mockEmbedding = Array(384).fill(0.5);
    await storeEmbedding(testPersonaId, testEntryId, mockEmbedding);
    
    const retrieved = await getEmbedding(testPersonaId, testEntryId);
    expect(retrieved).toEqual(mockEmbedding);
  });

  it('should get all embeddings for a persona', async () => {
    const embedding1 = Array(384).fill(0.1);
    const embedding2 = Array(384).fill(0.2);
    
    await storeEmbedding(testPersonaId, 'entry-1', embedding1);
    await storeEmbedding(testPersonaId, 'entry-2', embedding2);
    
    const store = await getAllEmbeddings(testPersonaId);
    expect(Object.keys(store.embeddings)).toHaveLength(2);
    expect(store.embeddings['entry-1']).toEqual(embedding1);
    expect(store.embeddings['entry-2']).toEqual(embedding2);
  });

  it('should delete embeddings', async () => {
    const mockEmbedding = Array(384).fill(0.5);
    await storeEmbedding(testPersonaId, testEntryId, mockEmbedding);
    
    let retrieved = await getEmbedding(testPersonaId, testEntryId);
    expect(retrieved).toEqual(mockEmbedding);
    
    await deleteEmbedding(testPersonaId, testEntryId);
    
    retrieved = await getEmbedding(testPersonaId, testEntryId);
    expect(retrieved).toBeNull();
  });

  it('should generate and store embedding for memory entry', async () => {
    const success = await embedMemoryEntry(testPersonaId, testEntryId, testContent);
    expect(success).toBe(true);
    
    const embedding = await getEmbedding(testPersonaId, testEntryId);
    expect(embedding).toBeTruthy();
    expect(embedding!.length).toBe(384);
  });
});
