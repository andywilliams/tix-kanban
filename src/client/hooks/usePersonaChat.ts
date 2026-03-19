import { useState, useEffect, useCallback, useRef } from 'react';
import { Persona } from '../types';

export interface PersonaChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  author?: string;
}

export interface PersonaWithSession {
  persona: Persona;
  sessionId?: string;
  lastMessage?: PersonaChatMessage;
  unreadCount: number;
  loading: boolean;
}

export function usePersonaChat(currentUser: string) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaData, setPersonaData] = useState<Record<string, PersonaWithSession>>({});
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PersonaChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageCountRef = useRef<number>(0);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load all personas
  const loadPersonas = useCallback(async () => {
    setError(null); // Clear any previous errors (Issue #3)
    try {
      const res = await fetch('/api/personas');
      if (!res.ok) throw new Error('Failed to load personas');
      const data = await res.json();
      const loadedPersonas: Persona[] = data.personas || [];
      setPersonas(loadedPersonas);

      // Initialize persona data map
      setPersonaData(prev => {
        const updated = { ...prev };
        for (const p of loadedPersonas) {
          if (!updated[p.id]) {
            updated[p.id] = { persona: p, unreadCount: 0, loading: false };
          } else {
            updated[p.id] = { ...updated[p.id], persona: p };
          }
        }
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personas');
    }
  }, []);

  // Load last message preview for each persona (Issue #7: parallelize)
  const loadLastMessages = useCallback(async (personaIds: string[]) => {
    await Promise.all(
      personaIds.map(async (personaId) => {
        try {
          const res = await fetch(`/api/personas/${personaId}/session/messages?limit=1`);
          if (!res.ok) return;
          const data = await res.json();
          const msgs: PersonaChatMessage[] = data.messages || [];
          const last = msgs[msgs.length - 1];
          if (last) {
            setPersonaData(prev => ({
              ...prev,
              [personaId]: { ...prev[personaId], lastMessage: last },
            }));
          }
        } catch {
          // ignore
        }
      })
    );
  }, []);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  useEffect(() => {
    if (personas.length > 0) {
      loadLastMessages(personas.map(p => p.id));
    }
  }, [personas, loadLastMessages]);

  // Load messages for selected persona
  const loadMessages = useCallback(async (personaId: string) => {
    setError(null); // Clear any previous errors (Issue #3)
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/personas/${personaId}/session/messages`);
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      const msgs: PersonaChatMessage[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: m.content,
        createdAt: m.createdAt,
        author: m.role === 'user' ? currentUser : undefined,
      }));
      setMessages(msgs);
      lastMessageCountRef.current = msgs.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [currentUser]);

  // Poll for new messages while a persona is selected
  const startPolling = useCallback((personaId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/personas/${personaId}/session/messages`);
        if (!res.ok) return;
        const data = await res.json();
        const msgs: PersonaChatMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
          content: m.content,
          createdAt: m.createdAt,
          author: m.role === 'user' ? currentUser : undefined,
        }));
        if (msgs.length !== lastMessageCountRef.current) {
          setMessages(msgs);
          lastMessageCountRef.current = msgs.length;
          // Update last message preview
          const last = msgs[msgs.length - 1];
          if (last) {
            setPersonaData(prev => ({
              ...prev,
              [personaId]: { ...prev[personaId], lastMessage: last },
            }));
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, [currentUser]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Select a persona and load their conversation
  const selectPersona = useCallback(async (personaId: string) => {
    stopPolling();
    // Clear any pending reload timeout when switching personas (Issue #4)
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }
    setSelectedPersonaId(personaId);
    setMessages([]);
    await loadMessages(personaId);
    startPolling(personaId);
    // Clear unread
    setPersonaData(prev => ({
      ...prev,
      [personaId]: { ...prev[personaId], unreadCount: 0 },
    }));
  }, [loadMessages, startPolling, stopPolling]);

  // Send a message to the selected persona
  const sendMessage = useCallback(async (content: string) => {
    if (!selectedPersonaId || !content.trim()) return;
    setError(null); // Clear any previous errors (Issue #3)
    setSending(true);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    const tempMsg: PersonaChatMessage = {
      id: tempId,
      role: 'user',
      content: content.trim(),
      createdAt: new Date().toISOString(),
      author: currentUser,
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      // Issue #1 & #2: Use session endpoint consistently for both read and write
      // Start direct conversation via the persona chat endpoint
      const startRes = await fetch(`/api/personas/${selectedPersonaId}/chat/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser }),
      });

      if (!startRes.ok) {
        // Issue #2: Set error and don't schedule reload if chat start fails
        setError('Failed to start chat session. Please try again.');
        setMessages(prev => prev.filter(m => m.id !== tempId));
        return;
      }

      const { channelId } = await startRes.json();
      if (channelId) {
        // Send to channel
        const messageRes = await fetch(`/api/chat/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: currentUser,
            authorType: 'human',
            content: content.trim(),
          }),
        });

        // Issue #5: Check response status
        if (!messageRes.ok) {
          throw new Error('Failed to send message to channel');
        }
      }

      // Issue #4: Store timeout ID and check persona still matches before reloading
      reloadTimeoutRef.current = setTimeout(() => {
        // Only reload if we're still viewing the same persona
        if (selectedPersonaId === selectedPersonaId) {
          loadMessages(selectedPersonaId);
        }
        reloadTimeoutRef.current = null;
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setSending(false);
    }
  }, [selectedPersonaId, currentUser, loadMessages]);

  // Cleanup polling and timeouts on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [stopPolling]);

  const selectedPersona = selectedPersonaId
    ? personaData[selectedPersonaId]?.persona ?? null
    : null;

  return {
    personas,
    personaData,
    selectedPersonaId,
    selectedPersona,
    messages,
    loadingMessages,
    sending,
    error,
    selectPersona,
    sendMessage,
    refreshPersona: () => selectedPersonaId && loadMessages(selectedPersonaId),
  };
}
