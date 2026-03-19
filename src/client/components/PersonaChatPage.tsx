import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePersonaChat } from '../hooks/usePersonaChat';
import './persona-chat.css';

interface PersonaChatPageProps {
  currentUser?: string;
}

function formatTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatPreview(content: string | undefined): string {
  if (!content) return 'No messages yet';
  const trimmed = content.replace(/\n/g, ' ').trim();
  return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
}

function getUserInitials(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function PersonaChatPage({ currentUser = 'User' }: PersonaChatPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
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
    refreshPersona,
  } = usePersonaChat(currentUser);

  // Auto-select from URL param
  useEffect(() => {
    const personaParam = searchParams.get('persona');
    if (personaParam && personas.length > 0 && personaParam !== selectedPersonaId) {
      selectPersona(personaParam);
    }
  }, [searchParams, personas, selectedPersonaId, selectPersona]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectPersona = useCallback((personaId: string) => {
    selectPersona(personaId);
    setSearchParams({ persona: personaId });
    setMobileSidebarOpen(false); // collapse sidebar on mobile after selection
  }, [selectPersona, setSearchParams]);

  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || sending || !selectedPersonaId) return;
    setInputValue('');
    await sendMessage(content);
  }, [inputValue, sending, selectedPersonaId, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  const filteredPersonas = personas.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="persona-chat">
      {/* ── Left sidebar ── */}
      <aside className={`persona-chat__sidebar ${!mobileSidebarOpen && selectedPersonaId ? 'persona-chat__sidebar--hidden' : ''}`}>
        <div className="persona-chat__sidebar-header">
          <p className="persona-chat__sidebar-title">💬 Direct Messages</p>
          <input
            className="persona-chat__search"
            type="search"
            placeholder="Search personas…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="persona-chat__persona-list">
          {filteredPersonas.length === 0 && (
            <div className="persona-chat__sidebar-empty">
              {searchQuery ? 'No personas match your search.' : 'No personas yet. Create one in the Personas page.'}
            </div>
          )}
          {filteredPersonas.map(persona => {
            const data = personaData[persona.id];
            const isActive = persona.id === selectedPersonaId;
            const lastMsg = data?.lastMessage;
            const unread = data?.unreadCount ?? 0;
            return (
              <div
                key={persona.id}
                className={`persona-chat__persona-item ${isActive ? 'persona-chat__persona-item--active' : ''}`}
                onClick={() => handleSelectPersona(persona.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleSelectPersona(persona.id)}
                aria-label={`Open chat with ${persona.name}`}
              >
                <div className="persona-chat__avatar">{persona.emoji || '🤖'}</div>
                <div className="persona-chat__persona-info">
                  <div className="persona-chat__persona-name">{persona.name}</div>
                  <div className="persona-chat__persona-preview">
                    {lastMsg
                      ? (lastMsg.role === 'user' ? `You: ` : '') + formatPreview(lastMsg.content)
                      : formatPreview(persona.description)}
                  </div>
                </div>
                {unread > 0 && (
                  <div className="persona-chat__unread-badge">{unread > 99 ? '99+' : unread}</div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="persona-chat__main">
        {!selectedPersona ? (
          <div className="persona-chat__no-selection">
            <div className="persona-chat__no-selection-icon">💬</div>
            <h2>Select a persona</h2>
            <p>Pick someone from the left panel to start a conversation.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="persona-chat__header">
              <button
                className="persona-chat__back-btn"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Back to persona list"
              >
                ← Back
              </button>
              <div className="persona-chat__avatar--large">{selectedPersona.emoji || '🤖'}</div>
              <div className="persona-chat__header-info">
                <div className="persona-chat__header-name">{selectedPersona.name}</div>
                <div className="persona-chat__header-desc">
                  {selectedPersona.description || selectedPersona.specialties?.join(', ') || 'AI Persona'}
                </div>
              </div>
              <div className="persona-chat__header-actions">
                <button
                  className="persona-chat__icon-btn"
                  onClick={() => refreshPersona()}
                  title="Refresh conversation"
                >
                  🔄 Refresh
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="persona-chat__messages" role="log" aria-live="polite" aria-label="Conversation">
              {loadingMessages ? (
                <div className="persona-chat__loading">
                  <span>Loading conversation…</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="persona-chat__empty">
                  <div className="persona-chat__empty-avatar">{selectedPersona.emoji || '🤖'}</div>
                  <h3>Start a conversation</h3>
                  <p>Send a message to begin chatting with {selectedPersona.name}.</p>
                </div>
              ) : (
                messages.map(msg => {
                  const isUser = msg.role === 'user';
                  const isSystem = msg.role === 'system';

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="persona-chat__msg-group">
                        <div className="persona-chat__msg-row">
                          <div className="persona-chat__msg-content" style={{ maxWidth: '100%' }}>
                            <div className="persona-chat__msg-bubble persona-chat__msg-bubble--system">
                              {msg.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className="persona-chat__msg-group">
                      <div className={`persona-chat__msg-row ${isUser ? 'persona-chat__msg-row--user' : ''}`}>
                        {!isUser && (
                          <div className="persona-chat__msg-avatar">
                            {selectedPersona.emoji || '🤖'}
                          </div>
                        )}
                        <div className="persona-chat__msg-content">
                          <div className="persona-chat__msg-meta">
                            <span className="persona-chat__msg-author">
                              {isUser ? (msg.author || currentUser) : selectedPersona.name}
                            </span>
                            <span className="persona-chat__msg-time">{formatTime(msg.createdAt)}</span>
                          </div>
                          <div className={`persona-chat__msg-bubble ${isUser ? 'persona-chat__msg-bubble--user' : 'persona-chat__msg-bubble--assistant'}`}>
                            {msg.content}
                            {msg.executionStatus && (
                              <div className={`persona-chat__execution-status persona-chat__execution-status--${msg.executionStatus}`}>
                                {msg.executionStatus === 'spawned' && '🚀 Spawning sub-agent...'}
                                {msg.executionStatus === 'done' && (
                                  msg.prUrl ? (
                                    <>✅ Done! <a href={msg.prUrl} target="_blank" rel="noopener noreferrer">View PR</a></>
                                  ) : (
                                    <span>✅ Done!</span>
                                  )
                                )}
                                {msg.executionStatus === 'error' && '❌ Execution failed'}
                              </div>
                            )}
                          </div>
                        </div>
                        {isUser && (
                          <div className={`persona-chat__msg-avatar persona-chat__msg-avatar--user`}>
                            {getUserInitials(currentUser)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Sending indicator */}
              {sending && (
                <div className="persona-chat__msg-group">
                  <div className="persona-chat__msg-row">
                    <div className="persona-chat__msg-avatar">{selectedPersona.emoji || '🤖'}</div>
                    <div className="persona-chat__msg-content">
                      <div className="persona-chat__msg-meta">
                        <span className="persona-chat__msg-author">{selectedPersona.name}</span>
                      </div>
                      <div className="persona-chat__msg-loading">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Error banner */}
            {error && (
              <div style={{
                padding: '8px 20px',
                background: 'rgba(239,68,68,0.1)',
                borderTop: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444',
                fontSize: '0.8rem',
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* Input */}
            <div className="persona-chat__input-area">
              <div className="persona-chat__input-wrapper">
                <textarea
                  ref={inputRef}
                  className="persona-chat__input"
                  placeholder={`Message ${selectedPersona.name}…`}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={sending}
                  aria-label={`Message ${selectedPersona.name}`}
                />
                <button
                  className="persona-chat__send-btn"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || sending}
                  aria-label="Send message"
                >
                  ➤
                </button>
              </div>
              <div className="persona-chat__input-hint">
                Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PersonaChatPage;
