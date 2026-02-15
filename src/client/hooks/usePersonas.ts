import { useState, useEffect } from 'react';
import { Persona } from '../types/index';

const API_BASE = '/api';

export function usePersonas() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPersonas = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE}/personas`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setPersonas(data.personas || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch personas');
      console.error('Failed to fetch personas:', err);
    } finally {
      setLoading(false);
    }
  };

  const createPersona = async (personaData: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const response = await fetch(`${API_BASE}/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personaData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const newPersona = data.persona;
      
      setPersonas(prev => [...prev, newPersona]);
      return newPersona;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create persona';
      setError(message);
      console.error('Failed to create persona:', err);
      throw err;
    }
  };

  const updatePersona = async (personaId: string, updates: Partial<Persona>) => {
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const updatedPersona = data.persona;
      
      setPersonas(prev => prev.map(p => p.id === personaId ? updatedPersona : p));
      return updatedPersona;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update persona';
      setError(message);
      console.error('Failed to update persona:', err);
      throw err;
    }
  };

  const deletePersona = async (personaId: string) => {
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      setPersonas(prev => prev.filter(p => p.id !== personaId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete persona';
      setError(message);
      console.error('Failed to delete persona:', err);
      throw err;
    }
  };

  const getPersona = async (personaId: string): Promise<Persona | null> => {
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}`);
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.persona;
    } catch (err) {
      console.error(`Failed to get persona ${personaId}:`, err);
      return null;
    }
  };

  useEffect(() => {
    fetchPersonas();
  }, []);

  return {
    personas,
    loading,
    error,
    refetch: fetchPersonas,
    createPersona,
    updatePersona,
    deletePersona,
    getPersona,
  };
}