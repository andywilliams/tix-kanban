import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatChannel, ChatMessage, Persona, AgentSoul } from '../types';

interface TeamChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentChannel: ChatChannel | null;
  channels: ChatChannel[];
  personas: Persona[];
  currentUser: string;
  onSendMessage: (channelId: string, content: string, replyTo?: string) => void;
  onSwitchChannel: (channel: ChatChannel) => void;
  onCreateTaskChannel: (taskId: string, taskTitle: string) => void;
  onStartDirectChat: (personaId: string) => void;
}

type ViewMode = 'channels' | 'team' | 'direct';

export default function TeamChatPanel({ 
  isOpen, onClose, currentChannel, channels, personas, currentUser,
  onSendMessage, onSwitchChannel, onCreateTaskChannel, onStartDirectChat
}: TeamChatPanelProps) {
  const [messageInput, setMessageInput] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Persona[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [personaSouls, setPersonaSouls] = useState<Record<string, AgentSoul>>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load souls for all personas
  useEffect(() => {
    const loadSouls = async () => {
      for (const persona of personas) {
        try {
          const response = await fetch(`/api/personas/${persona.id}/soul`);
          if (response.ok) {
            const data = await response.json();
            setPersonaSouls(prev => ({ ...prev, [persona.id]: data.soul }));
          }
        } catch (error) {
          console.error(`Failed to load soul for ${persona.id}:`, error);
        }
      }
    };
    
    if (personas.length > 0) {
      loadSouls();
    }
  }, [personas]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChannel?.messages]);

  // Mention autocomplete
  useEffect(() => {
    if (messageInput.includes('@')) {
      const atIndex = messageInput.lastIndexOf('@', cursorPosition);
      if (atIndex !== -1) {
        const query = messageInput.slice(atIndex + 1, cursorPosition);
        if (query.length >= 0 && !query.includes(' ')) {
          setMentionSuggestions(
            personas.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
          );
          setShowMentionSuggestions(true);
          return;
        }
      }
    }
    setShowMentionSuggestions(false);
  }, [messageInput, cursorPosition, personas]);

  const handleSendMessage = () => {
    if (!messageInput.trim() || !currentChannel) return;
    onSendMessage(currentChannel.id, messageInput.trim(), replyToMessage?.id);
    setMessageInput('');
    setReplyToMessage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    else if (e.key === 'Escape') setReplyToMessage(null);
  };

  const handleMentionSelect = (persona: Persona) => {
    const atIndex = messageInput.lastIndexOf('@', cursorPosition);
    const newMessage = messageInput.slice(0, atIndex + 1) + persona.name + ' ' + messageInput.slice(cursorPosition);
    setMessageInput(newMessage);
    setShowMentionSuggestions(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handlePersonaClick = (persona: Persona) => {
    setSelectedPersona(persona);
    onStartDirectChat(persona.id);
    // Switch to channels view to show the conversation
    setViewMode('channels');
  };

  const formatMessageContent = (content: string): JSX.Element => {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const parts = content.split(mentionRegex);
    return (
      <span>
        {parts.map((part, index) => {
          if (index % 2 === 1) {
            const persona = personas.find(p => 
              p.name.toLowerCase() === part.toLowerCase() ||
              p.id.toLowerCase() === part.toLowerCase()
            );
            return (
              <span key={index} style={{
                background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent)',
                padding: '0 0.25rem', borderRadius: '0.2rem', fontWeight: 500,
                cursor: persona ? 'pointer' : 'default'
              }} 
              onClick={() => persona && handlePersonaClick(persona)}
              title={persona ? `${persona.emoji} ${persona.description}` : undefined}>
                @{part}
              </span>
            );
          }
          return part;
        })}
      </span>
    );
  };

  const formatTimestamp = (date: Date): string => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return new Date(date).toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, height: '100%', width: '28rem',
      background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.3)'
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>
            🤝 Team Chat
          </h2>
          <button onClick={onClose}
            style={{ padding: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>
            ✕
          </button>
        </div>
        
        {/* View Mode Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.75rem' }}>
          {(['team', 'channels'] as ViewMode[]).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{
                padding: '0.4rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem',
                fontWeight: 500, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                background: viewMode === mode ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: viewMode === mode ? '#fff' : 'var(--text-secondary)'
              }}>
              {mode === 'team' ? '👥 Team' : '💬 Channels'}
            </button>
          ))}
        </div>
      </div>

      {/* Team View */}
      {viewMode === 'team' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Click on a team member to start a conversation, or mention them with @
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {personas.map(persona => {
              const soul = personaSouls[persona.id];
              return (
                <div key={persona.id}
                  onClick={() => handlePersonaClick(persona)}
                  style={{
                    padding: '1rem',
                    background: selectedPersona?.id === persona.id ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-secondary)',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    border: selectedPersona?.id === persona.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    transition: 'all 0.2s'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '2.5rem', height: '2.5rem', 
                      background: 'var(--bg-tertiary)', borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.25rem'
                    }}>
                      {persona.emoji}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {persona.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {soul?.teamRole || persona.description}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {persona.stats.tasksCompleted} tasks
                    </div>
                  </div>
                  
                  {/* Soul info */}
                  {soul && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
                        {soul.traits.slice(0, 3).map(trait => (
                          <span key={trait.name} style={{
                            padding: '0.15rem 0.4rem', background: 'var(--bg-tertiary)',
                            borderRadius: '0.25rem', fontSize: '0.7rem', color: 'var(--text-secondary)'
                          }}>
                            {trait.name}
                          </span>
                        ))}
                      </div>
                      {soul.catchphrases[0] && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          "{soul.catchphrases[0]}"
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Channels View */}
      {viewMode === 'channels' && (
        <>
          {/* Channel List */}
          <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
              {channels.map(channel => (
                <button key={channel.id} onClick={() => onSwitchChannel(channel)}
                  style={{
                    padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem',
                    whiteSpace: 'nowrap', border: 'none', cursor: 'pointer',
                    background: currentChannel?.id === channel.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: currentChannel?.id === channel.id ? '#fff' : 'var(--text-secondary)'
                  }}>
                  {channel.type === 'general' ? '🏠' : '📋'} {channel.name}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {!currentChannel ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                <p>Select a channel to start chatting</p>
              </div>
            ) : currentChannel.messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                <p>No messages yet. Start the conversation!</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Tip: Use @{personas[0]?.name || 'PersonaName'} to mention a team member
                </p>
              </div>
            ) : (
              currentChannel.messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  personas={personas}
                  souls={personaSouls}
                  formatContent={formatMessageContent}
                  formatTime={formatTimestamp}
                  onReply={() => setReplyToMessage(message)}
                  onPersonaClick={handlePersonaClick}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply indicator */}
          {replyToMessage && (
            <div style={{
              padding: '0.5rem 1rem', background: 'rgba(59, 130, 246, 0.1)',
              borderTop: '1px solid var(--border)', fontSize: '0.8rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Replying to <strong>{replyToMessage.author}</strong>
                </span>
                <button onClick={() => setReplyToMessage(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Mention suggestions */}
          {showMentionSuggestions && mentionSuggestions.length > 0 && (
            <div style={{ padding: '0 1rem' }}>
              <div style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: '0.5rem', maxHeight: '10rem', overflowY: 'auto'
              }}>
                {mentionSuggestions.map(persona => (
                  <button key={persona.id} onClick={() => handleMentionSelect(persona)}
                    style={{
                      width: '100%', padding: '0.5rem', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)'
                    }}>
                    <span>{persona.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{persona.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {personaSouls[persona.id]?.teamRole || persona.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message Input */}
          {currentChannel && (
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <textarea ref={inputRef} value={messageInput}
                  onChange={(e) => { setMessageInput(e.target.value); setCursorPosition(e.target.selectionStart); }}
                  onKeyDown={handleKeyDown}
                  onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
                  placeholder="Message the team... Use @ to mention"
                  rows={2}
                  style={{
                    flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', resize: 'none',
                    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                  }}
                />
                <button onClick={handleSendMessage} disabled={!messageInput.trim()}
                  style={{
                    padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff',
                    borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 500,
                    fontSize: '0.85rem', opacity: messageInput.trim() ? 1 : 0.5, alignSelf: 'flex-end'
                  }}>
                  Send
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                💡 Tip: "@Developer remember that I prefer TypeScript" to save to memory
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Message bubble component
function MessageBubble({
  message, personas, souls, formatContent, formatTime, onReply, onPersonaClick
}: {
  message: ChatMessage;
  personas: Persona[];
  souls: Record<string, AgentSoul>;
  formatContent: (content: string) => JSX.Element;
  formatTime: (date: Date) => string;
  onReply: () => void;
  onPersonaClick: (persona: Persona) => void;
}) {
  const persona = message.authorType === 'persona' 
    ? personas.find(p => p.name === message.author)
    : null;
  const soul = persona ? souls[persona.id] : null;

  return (
    <div className="chat-message-group" style={{ position: 'relative' }}>
      {message.replyTo && (
        <div style={{ 
          fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', 
          paddingLeft: '1rem', borderLeft: '2px solid var(--border)' 
        }}>
          Replying to previous message
        </div>
      )}
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div 
          style={{
            width: '2rem', height: '2rem', background: 'var(--bg-tertiary)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
            flexShrink: 0, color: 'var(--text-primary)',
            cursor: persona ? 'pointer' : 'default'
          }}
          onClick={() => persona && onPersonaClick(persona)}
        >
          {persona?.emoji || message.author[0]?.toUpperCase()}
        </div>
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span 
              style={{ 
                fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-primary)',
                cursor: persona ? 'pointer' : 'default'
              }}
              onClick={() => persona && onPersonaClick(persona)}
            >
              {message.author}
            </span>
            {soul && (
              <span style={{ 
                fontSize: '0.65rem', color: 'var(--text-muted)', 
                background: 'var(--bg-tertiary)', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' 
              }}>
                {soul.teamRole}
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {formatTime(message.createdAt)}
            </span>
          </div>
          <div style={{ 
            fontSize: '0.85rem', marginTop: '0.2rem', color: 'var(--text-secondary)', 
            wordBreak: 'break-word', lineHeight: 1.5 
          }}>
            {formatContent(message.content)}
          </div>
        </div>
        
        <button onClick={onReply} className="chat-reply-btn"
          style={{ 
            padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', 
            opacity: 0, fontSize: '0.75rem', color: 'var(--text-muted)',
            transition: 'opacity 0.2s'
          }}
          title="Reply">
          ↩️
        </button>
      </div>
    </div>
  );
}
