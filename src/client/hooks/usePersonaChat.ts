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
  const latestRequestIdRef = useRef<number>(0);
  // Store the direct channel id per persona so reads and writes use the same store (Issue #1)
  const personaChannelIds = useRef<Record<string, string>>({});

  // Helper to map channel message format to PersonaChatMessage
  const mapChannelMessage = (m: any, currentUser: string): PersonaChatMessage => ({
    id: m.id,
    role: m.authorType === 'persona' ? 'assistant' : 'user',
    content: m.content,
    createdAt: m.createdAt,
    author: m.authorType === 'human' ? currentUser : undefined,
  });

  // Helper to map session message format to PersonaChatMessage
  const mapSessionMessage = (m: any, currentUser: string): PersonaChatMessage => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.content,
    createdAt: m.createdAt,
    author: m.role === 'user' ? currentUser : undefined,
  });

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
          const msgs: PersonaChatMessage[] = (data.messages || []).map((m: any) => mapSessionMessage(m, currentUser));
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
  // Issue #1: read from the direct channel if we have one, otherwise fall back to session
  const loadMessages = useCallback(async (personaId: string, silentRefresh = false, requestId?: number) => {
    if (!silentRefresh) {
      setError(null); // Clear any previous errors (Issue #3)
      setLoadingMessages(true);
    }
    try {
      const channelId = personaChannelIds.current[personaId];
      let msgs: PersonaChatMessage[] = [];

      if (channelId) {
        // Read from the same channel we write to (Issue #1 fix)
        const res = await fetch(`/api/chat/${channelId}/messages`);
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        msgs = (data.messages || []).map((m: any) => mapChannelMessage(m, currentUser));
      } else {
        // Fall back to session endpoint before a channel has been established
        const res = await fetch(`/api/personas/${personaId}/session/messages`);
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        msgs = (data.messages || []).map((m: any) => mapSessionMessage(m, currentUser));
      }

      // Check if this request has been superseded by a newer one
      if (requestId !== undefined && requestId !== latestRequestIdRef.current) {
        return;
      }
      setMessages(msgs);
      lastMessageCountRef.current = msgs.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      if (!silentRefresh) {
        setLoadingMessages(false);
      }
    }
  }, [currentUser]);

  // Poll for new messages while a persona is selected
  const startPolling = useCallback((personaId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const channelId = personaChannelIds.current[personaId];
        let msgs: PersonaChatMessage[] = [];

        if (channelId) {
          const res = await fetch(`/api/chat/${channelId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          msgs = (data.messages || []).map((m: any) => mapChannelMessage(m, currentUser));
        } else {
          const res = await fetch(`/api/personas/${personaId}/session/messages`);
          if (!res.ok) return;
          const data = await res.json();
          msgs = (data.messages || []).map((m: any) => mapSessionMessage(m, currentUser));
        }

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
    // Clear any pending reload timeout when switching persona (Issue #4)
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }
    // Increment request ID to guard against stale responses from rapid selections
    const requestId = ++latestRequestIdRef.current;
    setSelectedPersonaId(personaId);
    setMessages([]);
    await loadMessages(personaId, false, requestId);
    // Check if this request is still the latest one before starting polling
    if (requestId !== latestRequestIdRef.current) return;
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
    setSending(true);
    setError(null); // Clear any previous errors (Issue #3)

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

    // Capture the current persona at call time to guard against stale refs (Issue #4)
    const capturedPersonaId = selectedPersonaId;

    try {
      // Use cached channelId if available, otherwise start a new conversation
      let channelId = personaChannelIds.current[capturedPersonaId];
      
      if (!channelId) {
        const startRes = await fetch(`/api/personas/${capturedPersonaId}/chat/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser }),
        });

        if (!startRes.ok) {
          // Issue #2: surface the error instead of silently losing the message
          setError('Failed to start conversation — please try again');
          setMessages(prev => prev.filter(m => m.id !== tempId));
          return;
        }

        const { channelId: newChannelId } = await startRes.json();
        channelId = newChannelId;
        if (channelId) {
          // Store the channel id so future loadMessages reads from the same store (Issue #1)
          personaChannelIds.current[capturedPersonaId] = channelId;
        }
      }

      if (channelId) {
        // Send to channel (Issue #5: check response.ok)
        const messageRes = await fetch(`/api/chat/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: currentUser,
            authorType: 'human',
            content: content.trim(),
          }),
        });

        if (!messageRes.ok) {
          // Issue #5: handle failed message POST
          setError('Failed to send message — please try again');
          setMessages(prev => prev.filter(m => m.id !== tempId));
          return;
        }
      } else {
        // Issue #1 fix: handle falsy channelId - set error and remove optimistic message
        setError('Failed to start conversation — please try again');
        setMessages(prev => prev.filter(m => m.id !== tempId));
        return;
      }

      // Issue #4: clear any existing reload timeout and capture personaId in closure
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = setTimeout(() => {
        // Only reload if the user hasn't switched to a different persona
        if (capturedPersonaId === selectedPersonaId) {
          loadMessages(capturedPersonaId, true); // silentRefresh: true to avoid loading flash
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

  // Cleanup polling and pending timeouts on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
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
