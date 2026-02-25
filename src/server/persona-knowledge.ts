/**
 * Knowledge Base Integration for Personas
 *
 * Provides utilities for personas to access and search the knowledge base
 * during conversations and task execution.
 */

import { searchKnowledgeDocs, KnowledgeDoc } from './knowledge-storage.js';
import { Persona } from '../client/types/index.js';

/**
 * Extract keywords from a message for knowledge search
 */
export function extractKeywords(text: string): string {
  // Remove common words and extract meaningful keywords
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'how', 'can', 'should', 'would', 'could', 'what', 'which', 'when', 'where',
    'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does'
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word));

  // Look for technical terms and compound words
  const technicalTerms = [];
  for (let i = 0; i < words.length - 1; i++) {
    // Detect compound technical terms like "api-design" or "database schema"
    if (words[i].includes('-') ||
        (words[i] === 'api' && words[i+1] === 'design') ||
        (words[i] === 'database' && words[i+1] === 'schema')) {
      technicalTerms.push(`${words[i]} ${words[i+1]}`);
    }
  }

  return [...new Set([...words, ...technicalTerms])].join(' ');
}

/**
 * Get relevant knowledge for a persona based on the current context
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

    // Search for relevant knowledge
    const searchResults = await searchKnowledgeDocs({
      keywords,
      repo,
      limit
    });

    // For Product Manager, prioritize architecture and planning docs
    if (persona.id === 'product-manager') {
      const architectureDocs = await searchKnowledgeDocs({
        keywords: 'architecture system design patterns',
        area: 'general',
        limit: 2
      });

      // Combine and deduplicate results
      const allDocs = [...searchResults, ...architectureDocs];
      const uniqueDocs = Array.from(
        new Map(allDocs.map(r => [r.doc.id, r])).values()
      );

      // Sort by relevance score
      uniqueDocs.sort((a, b) => b.score - a.score);

      const docs = uniqueDocs.slice(0, limit).map(r => r.doc) as KnowledgeDoc[];

      // Generate summary
      const summary = generateKnowledgeSummary(docs);

      return { docs, summary };
    }

    // For other personas, use standard search results
    const docs = searchResults.map(r => r.doc) as KnowledgeDoc[];
    const summary = generateKnowledgeSummary(docs);

    return { docs, summary };
  } catch (error) {
    console.error('Failed to get relevant knowledge:', error);
    return { docs: [], summary: '' };
  }
}

/**
 * Generate a summary of knowledge docs for context
 */
function generateKnowledgeSummary(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) return '';

  const summaryParts = ['## Relevant Knowledge Base Articles\n'];

  for (const doc of docs) {
    summaryParts.push(`### ${doc.title}`);
    if (doc.description) {
      summaryParts.push(doc.description);
    }
    summaryParts.push(`- Area: ${doc.area} | Topic: ${doc.topic}`);
    if (doc.tags.length > 0) {
      summaryParts.push(`- Tags: ${doc.tags.join(', ')}`);
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

    if (architectureDocs.length === 0) {
      return '## Architecture Overview\nNo architecture documentation found in knowledge base.';
    }

    const overview = ['## System Architecture Overview\n'];

    for (const result of architectureDocs) {
      const doc = result.doc as KnowledgeDoc;
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
      area: options?.area as any,
      limit: options?.limit || 5
    });

    return results.map(r => r.doc as KnowledgeDoc);
  } catch (error) {
    console.error('Failed to search knowledge for topic:', error);
    return [];
  }
}

/**
 * Check if a persona should have knowledge base access
 */
export function shouldIncludeKnowledge(persona: Persona): boolean {
  // Product Manager always gets knowledge access
  if (persona.id === 'product-manager') return true;

  // Other personas get knowledge if their specialties suggest they need it
  const knowledgeSpecialties = [
    'architecture', 'api-design', 'system-design',
    'technical-writing', 'documentation'
  ];

  return persona.specialties.some(s =>
    knowledgeSpecialties.some(ks => s.includes(ks))
  );
}