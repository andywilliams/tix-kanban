/**
 * Knowledge Base Integration for Personas
 *
 * Provides utilities for personas to access and search the knowledge base
 * during conversations and task execution.
 *
 * All personas can access knowledge — retrieval is purely query-driven
 * with a minimum relevance threshold to filter noise.
 */

import { searchKnowledgeDocs, getKnowledgeDoc, KnowledgeDoc, KnowledgeSearchResult } from './knowledge-storage.js';
import { Persona } from '../client/types/index.js';

// Minimum relevance score for a knowledge doc to be included in context
const MIN_RELEVANCE_SCORE = 15;

// Max content snippet length for standard docs
const STANDARD_SNIPPET_LENGTH = 300;
// Max content snippet length for highly relevant docs (score > 50)
const HIGH_RELEVANCE_SNIPPET_LENGTH = 800;

/**
 * Extract keywords from a message for knowledge search
 */
export function extractKeywords(text: string): string {
  // Remove common words and extract meaningful keywords
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'how', 'can', 'should', 'would', 'could', 'what', 'which', 'when', 'where',
    'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does',
    'i', 'you', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our', 'their',
    'this', 'that', 'these', 'those', 'not', 'just', 'also', 'very', 'really'
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word));

  // Look for technical terms and compound words
  const technicalTerms: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // Detect hyphenated compound terms already in the text
    if (words[i].includes('-')) {
      technicalTerms.push(words[i]);
    }
  }

  return [...new Set([...words, ...technicalTerms])].join(' ');
}

/**
 * Get relevant knowledge for a persona based on the current context.
 * All personas can access knowledge — retrieval is query-driven.
 */
export async function getRelevantKnowledge(
  persona: Persona,
  message: string,
  repo?: string,
  limit: number = 3
): Promise<{ docs: KnowledgeDoc[]; summary: string }> {
  try {
    // Extract keywords from the message
    const keywords = extractKeywords(message);

    // If no meaningful keywords extracted, skip the search
    if (!keywords.trim()) {
      return { docs: [], summary: '' };
    }

    // Search for relevant knowledge
    const searchResults = await searchKnowledgeDocs({
      keywords,
      repo,
      limit: limit + 2 // Fetch extras so we can filter by threshold
    });

    // Apply minimum relevance threshold
    const filteredResults = searchResults.filter(r => r.score >= MIN_RELEVANCE_SCORE);

    if (filteredResults.length === 0) {
      return { docs: [], summary: '' };
    }

    // For Product Manager, also pull architecture docs when relevant
    if (persona.id === 'product-manager') {
      const architectureDocs = await searchKnowledgeDocs({
        keywords: 'architecture system design patterns',
        area: 'general',
        limit: 2
      });

      // Combine and deduplicate results
      const relevantArch = architectureDocs.filter(r => r.score >= MIN_RELEVANCE_SCORE);
      const allDocs = [...filteredResults, ...relevantArch];
      const uniqueDocs = Array.from(
        new Map(allDocs.map(r => [r.doc.id, r])).values()
      );

      // Sort by relevance score
      uniqueDocs.sort((a, b) => b.score - a.score);

      const topResults = uniqueDocs.slice(0, limit);
      const docs = await enrichWithContent(topResults);
      const summary = generateKnowledgeSummary(docs, topResults);

      return { docs, summary };
    }

    // For other personas, use filtered search results
    const topResults = filteredResults.slice(0, limit);
    const docs = await enrichWithContent(topResults);
    const summary = generateKnowledgeSummary(docs, topResults);

    return { docs, summary };
  } catch (error) {
    console.error('Failed to get relevant knowledge:', error);
    return { docs: [], summary: '' };
  }
}

/**
 * Enrich search results with full content for snippet extraction
 */
async function enrichWithContent(results: KnowledgeSearchResult[]): Promise<KnowledgeDoc[]> {
  const docs: KnowledgeDoc[] = [];
  for (const result of results) {
    try {
      const fullDoc = await getKnowledgeDoc(result.doc.id);
      if (fullDoc) {
        docs.push(fullDoc);
      }
    } catch (error) {
      // Skip docs that can't be loaded
      console.warn(`Failed to load knowledge doc ${result.doc.id}: ${error}`);
    }
  }
  return docs;
}

/**
 * Generate a summary of knowledge docs for context, including content snippets
 */
function generateKnowledgeSummary(docs: KnowledgeDoc[], results: KnowledgeSearchResult[]): string {
  if (docs.length === 0) return '';

  // Build a score lookup
  const scoreMap = new Map(results.map(r => [r.doc.id, r.score]));

  const summaryParts = ['## Relevant Knowledge Base Articles\n'];

  for (const doc of docs) {
    const score = scoreMap.get(doc.id) || 0;
    summaryParts.push(`### ${doc.title}`);
    if (doc.description) {
      summaryParts.push(doc.description);
    }
    summaryParts.push(`- Area: ${doc.area} | Topic: ${doc.topic}`);
    if (doc.tags.length > 0) {
      summaryParts.push(`- Tags: ${doc.tags.join(', ')}`);
    }

    // Include content snippet — more for highly relevant docs
    if (doc.content) {
      const snippetLength = score > 50 ? HIGH_RELEVANCE_SNIPPET_LENGTH : STANDARD_SNIPPET_LENGTH;
      const snippet = doc.content.trim().substring(0, snippetLength);
      const truncated = snippet.length < doc.content.trim().length;
      summaryParts.push(`\n${snippet}${truncated ? '...' : ''}`);
    }

    summaryParts.push(''); // Empty line between docs
  }

  return summaryParts.join('\n');
}

/**
 * Get architecture overview for Product Manager context
 */
export async function getArchitectureOverview(): Promise<string> {
  try {
    const architectureDocs = await searchKnowledgeDocs({
      keywords: 'architecture overview system design',
      area: 'general',
      limit: 5
    });

    const filtered = architectureDocs.filter(r => r.score >= MIN_RELEVANCE_SCORE);

    if (filtered.length === 0) {
      return '## Architecture Overview\nNo architecture documentation found in knowledge base.';
    }

    const overview = ['## System Architecture Overview\n'];

    for (const result of filtered) {
      const doc = result.doc;
      overview.push(`### ${doc.title}`);
      if (doc.description) {
        overview.push(doc.description);
      }
      overview.push('');
    }

    return overview.join('\n');
  } catch (error) {
    console.error('Failed to get architecture overview:', error);
    return '## Architecture Overview\nUnable to load architecture documentation.';
  }
}

/**
 * Search knowledge base for specific topics
 */
export async function searchKnowledgeForTopic(
  topic: string,
  options?: {
    repo?: string;
    area?: string;
    limit?: number;
  }
): Promise<KnowledgeDoc[]> {
  try {
    const results = await searchKnowledgeDocs({
      keywords: topic,
      repo: options?.repo,
      area: options?.area,
      limit: options?.limit || 5
    });

    // Apply threshold
    const filtered = results.filter(r => r.score >= MIN_RELEVANCE_SCORE);
    const enriched = await enrichWithContent(filtered);
    return enriched;
  } catch (error) {
    console.error('Failed to search knowledge for topic:', error);
    return [];
  }
}

/**
 * Check if a persona should have knowledge base access.
 * Now returns true for all personas — knowledge is query-driven.
 * Kept for backward compatibility but always returns true.
 */
export function shouldIncludeKnowledge(_persona: Persona): boolean {
  return true;
}
