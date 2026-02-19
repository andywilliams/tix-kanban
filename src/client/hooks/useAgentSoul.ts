import { useState, useCallback, useEffect } from 'react';
import { AgentSoul } from '../types';

const API_BASE = '/api';

export function useAgentSoul(personaId?: string) {
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSoul = useCallback(async () => {
    if (!personaId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}/soul`);
      if (!response.ok) throw new Error('Failed to fetch soul');
      
      const data = await response.json();
      setSoul(data.soul);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch soul');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    if (personaId) {
      fetchSoul();
    }
  }, [personaId, fetchSoul]);

  const updateSoul = useCallback(async (updates: Partial<AgentSoul>) => {
    if (!personaId) return null;
    
    try {
      const response = await fetch(`${API_BASE}/personas/${personaId}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) throw new Error('Failed to update soul');
      
      const data = await response.json();
      setSoul(data.soul);
      return data.soul;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update soul');
      throw err;
    }
  }, [personaId]);

  const updateTrait = useCallback(async (traitName: string, updates: { intensity?: number; description?: string }) => {
    if (!soul) return;
    
    const updatedTraits = soul.traits.map(t => 
      t.name === traitName ? { ...t, ...updates } : t
    );
    
    return updateSoul({ traits: updatedTraits });
  }, [soul, updateSoul]);

  const addTrait = useCallback(async (trait: { name: string; intensity: number; description: string }) => {
    if (!soul) return;
    
    const updatedTraits = [...soul.traits, trait];
    return updateSoul({ traits: updatedTraits });
  }, [soul, updateSoul]);

  const removeTrait = useCallback(async (traitName: string) => {
    if (!soul) return;
    
    const updatedTraits = soul.traits.filter(t => t.name !== traitName);
    return updateSoul({ traits: updatedTraits });
  }, [soul, updateSoul]);

  const updateCommunicationStyle = useCallback(async (style: Partial<AgentSoul['communicationStyle']>) => {
    if (!soul) return;
    
    return updateSoul({
      communicationStyle: { ...soul.communicationStyle, ...style }
    });
  }, [soul, updateSoul]);

  const addQuirk = useCallback(async (quirk: string) => {
    if (!soul) return;
    
    return updateSoul({ quirks: [...soul.quirks, quirk] });
  }, [soul, updateSoul]);

  const removeQuirk = useCallback(async (quirk: string) => {
    if (!soul) return;
    
    return updateSoul({ quirks: soul.quirks.filter(q => q !== quirk) });
  }, [soul, updateSoul]);

  const addCatchphrase = useCallback(async (phrase: string) => {
    if (!soul) return;
    
    return updateSoul({ catchphrases: [...soul.catchphrases, phrase] });
  }, [soul, updateSoul]);

  const removeCatchphrase = useCallback(async (phrase: string) => {
    if (!soul) return;
    
    return updateSoul({ catchphrases: soul.catchphrases.filter(p => p !== phrase) });
  }, [soul, updateSoul]);

  return {
    soul,
    loading,
    error,
    fetchSoul,
    updateSoul,
    updateTrait,
    addTrait,
    removeTrait,
    updateCommunicationStyle,
    addQuirk,
    removeQuirk,
    addCatchphrase,
    removeCatchphrase
  };
}

// Hook to fetch all souls
export function useAllSouls() {
  const [souls, setSouls] = useState<AgentSoul[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSouls = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/souls`);
      if (!response.ok) throw new Error('Failed to fetch souls');
      
      const data = await response.json();
      setSouls(data.souls || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch souls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSouls();
  }, [fetchSouls]);

  return { souls, loading, error, refetch: fetchSouls };
}
