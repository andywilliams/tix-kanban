import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');

// OpenAI client (lazy initialization with key tracking)
let openaiClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

export function clearOpenAIClient(): void {
  openaiClient = null;
  cachedApiKey = null;
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // Check if key has changed or been removed
  if (openaiClient && cachedApiKey !== apiKey) {
    openaiClient = null;
    cachedApiKey = null;
  }
  
  // Return cached client if still valid
  if (openaiClient) return openaiClient;
  
  // No API key - return null (embedding generation disabled)
  if (!apiKey) {
    console.warn('[Embeddings] OPENAI_API_KEY not set - embedding generation disabled');
    return null;
  }
  
  // Create new client with current API key
  openaiClient = new OpenAI({ apiKey });
  cachedApiKey = apiKey;
  return openaiClient;
}

// Embedding storage structure
export interface EmbeddingStore {
  version: 1;
  personaId: string;
  embeddings: {
    [entryId: string]: number[];
  };
  lastUpdated: string;
}

// Get embeddings store for a persona
async function getEmbeddingStore(personaId: string): Promise<EmbeddingStore> {
  try {
    const personaDir = path.join(PERSONAS_DIR, personaId);
    const embeddingsPath = path.join(personaDir, 'embeddings.json');
    const content = await fs.readFile(embeddingsPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: 1,
        personaId,
        embeddings: {},
        lastUpdated: new Date().toISOString(),
      };
    }
    throw error;
  }
}

// Save embeddings store
async function saveEmbeddingStore(store: EmbeddingStore): Promise<void> {
  const personaDir = path.join(PERSONAS_DIR, store.personaId);
  await fs.mkdir(personaDir, { recursive: true });
  
  const embeddingsPath = path.join(personaDir, 'embeddings.json');
  store.lastUpdated = new Date().toISOString();
  await fs.writeFile(embeddingsPath, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Generate embedding for text using OpenAI text-embedding-3-small
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getOpenAIClient();
  if (!client) {
    return null; // Graceful fallback
  }
  
  try {
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('[Embeddings] Failed to generate embedding:', error);
    return null;
  }
}

/**
 * Store embedding for a memory entry
 */
export async function storeEmbedding(
  personaId: string,
  entryId: string,
  embedding: number[]
): Promise<void> {
  const store = await getEmbeddingStore(personaId);
  store.embeddings[entryId] = embedding;
  await saveEmbeddingStore(store);
}

/**
 * Get embedding for a memory entry
 */
export async function getEmbedding(
  personaId: string,
  entryId: string
): Promise<number[] | null> {
  const store = await getEmbeddingStore(personaId);
  return store.embeddings[entryId] || null;
}

/**
 * Get all embeddings for a persona
 */
export async function getAllEmbeddings(personaId: string): Promise<EmbeddingStore> {
  return getEmbeddingStore(personaId);
}

/**
 * Delete embedding for a memory entry
 */
export async function deleteEmbedding(
  personaId: string,
  entryId: string
): Promise<void> {
  const store = await getEmbeddingStore(personaId);
  delete store.embeddings[entryId];
  await saveEmbeddingStore(store);
}

/**
 * Generate and store embedding for a memory entry
 */
export async function embedMemoryEntry(
  personaId: string,
  entryId: string,
  content: string
): Promise<boolean> {
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    return false; // API key not set or error
  }
  
  await storeEmbedding(personaId, entryId, embedding);
  return true;
}
