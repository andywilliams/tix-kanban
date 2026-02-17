import { useState, useEffect } from 'react';
import { KnowledgeDoc, KnowledgeMetadata, KnowledgeSearchResult } from '../types/index.js';

const API_BASE = '/api';

export function useKnowledge() {
  const [docs, setDocs] = useState<KnowledgeMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/knowledge`);
      if (!response.ok) {
        throw new Error(`Failed to fetch knowledge docs: ${response.status}`);
      }
      const data = await response.json();
      setDocs(data.docs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch knowledge docs');
      console.error('Error fetching knowledge docs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  return {
    docs,
    loading,
    error,
    refetch: fetchDocs
  };
}

export function useKnowledgeDoc(id: string | undefined) {
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDoc(null);
      setLoading(false);
      return;
    }

    const fetchDoc = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE}/knowledge/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Knowledge doc not found');
          }
          throw new Error(`Failed to fetch knowledge doc: ${response.status}`);
        }
        const data = await response.json();
        setDoc(data.doc || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch knowledge doc');
        console.error('Error fetching knowledge doc:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDoc();
  }, [id]);

  return {
    doc,
    loading,
    error
  };
}

export function useKnowledgeSearch(query: {
  keywords?: string;
  repo?: string;
  area?: string;
  tags?: string[];
  limit?: number;
}) {
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    try {
      setLoading(true);
      setError(null);

      // Build query string
      const params = new URLSearchParams();
      if (query.keywords) params.append('q', query.keywords);
      if (query.repo) params.append('repo', query.repo);
      if (query.area) params.append('area', query.area);
      if (query.tags && query.tags.length > 0) params.append('tags', query.tags.join(','));
      if (query.limit) params.append('limit', query.limit.toString());

      const response = await fetch(`${API_BASE}/knowledge/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to search knowledge docs: ${response.status}`);
      }
      const data = await response.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search knowledge docs');
      console.error('Error searching knowledge docs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Auto-search when query changes (if there are search terms)
    if (query.keywords || query.repo || query.area || (query.tags && query.tags.length > 0)) {
      search();
    } else {
      setResults([]);
    }
  }, [query.keywords, query.repo, query.area, query.tags?.join(','), query.limit]);

  return {
    results,
    loading,
    error,
    search
  };
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
    id?: string; // For updates
  }
): Promise<KnowledgeDoc | null> {
  try {
    const method = options.id ? 'PUT' : 'POST';
    const url = options.id ? `${API_BASE}/knowledge/${options.id}` : `${API_BASE}/knowledge`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        content,
        description: options.description,
        repo: options.repo,
        area: options.area,
        topic: options.topic,
        tags: options.tags || []
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save knowledge doc: ${response.status}`);
    }

    const data = await response.json();
    return data.doc || null;
  } catch (err) {
    console.error('Error saving knowledge doc:', err);
    return null;
  }
}

export async function deleteKnowledgeDoc(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/knowledge/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete knowledge doc: ${response.status}`);
    }
    return true;
  } catch (err) {
    console.error('Error deleting knowledge doc:', err);
    return false;
  }
}