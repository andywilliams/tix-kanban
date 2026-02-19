import { useState, useCallback } from 'react';
import { AgentMemory, MemoryEntry } from '../types';

const API_BASE = '/api';

export function useAgentMemory(personaId: string, userId: string = 'default') {
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMemory = useCallback(async () => {
    if (!personaId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}/agent-memory?userId=${userId}`);
      if (!response.ok) throw new Error('Failed to fetch memory');
      
      const data = await response.json();
      setMemory(data.memory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch memory');
    } finally {
      setLoading(false);
    }
  }, [personaId, userId]);

  const addEntry = useCallback(async (entry: {
    category: MemoryEntry['category'];
    content: string;
    keywords?: string[];
    importance?: number;
  }) => {
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}/agent-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entry, userId })
      });
      
      if (!response.ok) throw new Error('Failed to add memory');
      
      const data = await response.json();
      
      // Update local state
      setMemory(prev => prev ? {
        ...prev,
        entries: [...prev.entries, data.entry]
      } : null);
      
      return data.entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add memory');
      throw err;
    }
  }, [personaId, userId]);

  const updateEntry = useCallback(async (entryId: string, updates: Partial<MemoryEntry>) => {
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}/agent-memory/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, userId })
      });
      
      if (!response.ok) throw new Error('Failed to update memory');
      
      const data = await response.json();
      
      // Update local state
      setMemory(prev => prev ? {
        ...prev,
        entries: prev.entries.map(e => e.id === entryId ? data.entry : e)
      } : null);
      
      return data.entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update memory');
      throw err;
    }
  }, [personaId, userId]);

  const deleteEntry = useCallback(async (entryId: string) => {
    try {
      const response = await fetch(
        `${API_BASE}/personas/${personaId}/agent-memory/${entryId}?userId=${userId}`,
        { method: 'DELETE' }
      );
      
      if (!response.ok) throw new Error('Failed to delete memory');
      
      // Update local state
      setMemory(prev => prev ? {
        ...prev,
        entries: prev.entries.filter(e => e.id !== entryId)
      } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
      throw err;
    }
  }, [personaId, userId]);

  const searchMemories = useCallback(async (query: string, options?: {
    category?: MemoryEntry['category'];
    limit?: number;
  }) => {
    try {
      const params = new URLSearchParams({
        q: query,
        userId,
        ...(options?.category && { category: options.category }),
        ...(options?.limit && { limit: options.limit.toString() })
      });
      
      const response = await fetch(
        `${API_BASE}/personas/${personaId}/agent-memory/search?${params}`
      );
      
      if (!response.ok) throw new Error('Failed to search memories');
      
      const data = await response.json();
      return data.entries as MemoryEntry[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search memories');
      return [];
    }
  }, [personaId, userId]);

  const clearAllMemories = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE}/personas/${personaId}/agent-memory?userId=${userId}`,
        { method: 'DELETE' }
      );
      
      if (!response.ok) throw new Error('Failed to clear memories');
      
      setMemory(prev => prev ? { ...prev, entries: [] } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear memories');
      throw err;
    }
  }, [personaId, userId]);

  return {
    memory,
    loading,
    error,
    fetchMemory,
    addEntry,
    updateEntry,
    deleteEntry,
    searchMemories,
    clearAllMemories
  };
}
