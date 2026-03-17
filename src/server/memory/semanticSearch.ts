import { MemoryEntry } from '../persona-memory.js';
import { generateEmbedding, getAllEmbeddings } from './embeddings.js';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectors must have the same length');
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

export async function semanticSearch(
  personaId: string,
  query: string,
  entries: MemoryEntry[],
  options: { topK?: number; minSimilarity?: number } = {}
): Promise<Array<{ entry: MemoryEntry; score: number }>> {
  const topK = options.topK || 10;
  const minSimilarity = options.minSimilarity || 0.5;
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    console.warn('[SemanticSearch] Query embedding generation failed - returning empty results');
    return [];
  }
  const embeddingStore = await getAllEmbeddings(personaId);
  const scored: Array<{ entry: MemoryEntry; score: number }> = [];
  for (const entry of entries) {
    const embedding = embeddingStore.embeddings[entry.id];
    if (!embedding) continue;
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity >= minSimilarity) {
      scored.push({ entry, score: similarity });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function keywordSearch(
  query: string,
  entries: MemoryEntry[],
  topK: number = 10
): Array<{ entry: MemoryEntry; score: number }> {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
  const scored = entries.map(entry => {
    let score = 0;
    const contentLower = entry.content.toLowerCase();
    for (const word of queryWords) {
      if (contentLower.includes(word)) score += 2;
    }
    for (const tag of entry.tags) {
      if (queryLower.includes(tag.toLowerCase())) score += 3;
    }
    score += entry.importance === 'high' ? 2 : entry.importance === 'medium' ? 1 : 0;
    const daysOld = (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 7) score += 1;
    return { entry, score };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function hybridSearch(
  personaId: string,
  query: string,
  entries: MemoryEntry[],
  options: { topK?: number; semanticWeight?: number; minSimilarity?: number } = {}
): Promise<Array<{ entry: MemoryEntry; score: number }>> {
  const topK = options.topK || 10;
  const semanticWeight = options.semanticWeight !== undefined ? options.semanticWeight : 0.7;
  const keywordWeight = 1 - semanticWeight;
  const semanticResults = await semanticSearch(personaId, query, entries, {
    topK: topK * 2,
    minSimilarity: options.minSimilarity,
  });
  const keywordResults = keywordSearch(query, entries, topK * 2);
  const normalizeScores = (results: Array<{ entry: MemoryEntry; score: number }>) => {
    if (results.length === 0) return results;
    const maxScore = Math.max(...results.map(r => r.score));
    if (maxScore === 0) return results;
    return results.map(r => ({ ...r, score: r.score / maxScore }));
  };
  const normalizedSemantic = normalizeScores(semanticResults);
  const normalizedKeyword = normalizeScores(keywordResults);
  const merged = new Map<string, { entry: MemoryEntry; score: number }>();
  for (const result of normalizedSemantic) {
    merged.set(result.entry.id, {
      entry: result.entry,
      score: result.score * semanticWeight,
    });
  }
  for (const result of normalizedKeyword) {
    const existing = merged.get(result.entry.id);
    if (existing) {
      existing.score += result.score * keywordWeight;
    } else {
      merged.set(result.entry.id, {
        entry: result.entry,
        score: result.score * keywordWeight,
      });
    }
  }
  const combined = Array.from(merged.values()).sort((a, b) => b.score - a.score);
  return combined.slice(0, topK);
}

export async function smartSearch(
  personaId: string,
  query: string,
  entries: MemoryEntry[],
  options: { topK?: number; preferHybrid?: boolean } = {}
): Promise<Array<{ entry: MemoryEntry; score: number }>> {
  const topK = options.topK || 10;
  if (options.preferHybrid !== false) {
    const results = await hybridSearch(personaId, query, entries, { topK });
    if (results.length > 0) return results;
  }
  console.log('[SmartSearch] Using keyword search fallback');
  return keywordSearch(query, entries, topK);
}
