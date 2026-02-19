import React, { useState, useEffect, useRef } from 'react';
import { ChatChannel, ChatMessage, Persona } from '../types';

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentChannel: ChatChannel | null;
  channels: ChatChannel[];
  personas: Persona[];
  currentUser: string;
  onSendMessage: (channelId: string, content: string, replyTo?: string) => void;
  onSwitchChannel: (channel: ChatChannel) => void;
  onCreateTaskChannel: (taskId: string, taskTitle: string) => void;
  onCreatePersonaChannel?: (personaId: string, personaName: string, personaEmoji: string) => Promise<ChatChannel>;
}

export default function ChatPanel({ 
  isOpen, onClose, currentChannel, channels, personas, currentUser,
  onSendMessage, onSwitchChannel, onCreateTaskChannel, onCreatePersonaChannel 
}: ChatPanelProps) {
  const [showPersonaList, setShowPersonaList] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Persona[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChannel?.messages]);

  useEffect(() => {
    if (messageInput.includes('@')) {
      const atIndex = messageInput.lastIndexOf('@', cursorPosition);
      if (atIndex !== -1) {
        const query = messageInput.slice(atIndex + 1, cursorPosition);
        if (query.length >= 0 && !query.includes(' ')) {
          setMentionQuery(query);
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
    setCursorPosition(atIndex + persona.name.length + 2);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const formatMessageContent = (content: string): JSX.Element => {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const parts = content.split(mentionRegex);
    return (
      <span>
        {parts.map((part, index) => {
          if (index % 2 === 1) {
            const persona = personas.find(p => p.name === part);
            return (
              <span key={index} style={{
                background: 'var(--accent)', color: 'white',
                padding: '0.1rem 0.4rem', borderRadius: '0.3rem', fontWeight: 600,
                fontSize: '0.85em', display: 'inline-flex', alignItems: 'center',
                gap: '0.2rem', verticalAlign: 'baseline'
              }} title={persona ? `${persona.emoji} ${persona.description}` : undefined}>
                {persona?.emoji && <span style={{ fontSize: '0.9em' }}>{persona.emoji}</span>}
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
      position: 'fixed', right: 0, top: 0, height: '100%', width: '24rem',
      background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.3)'
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div>
          <h2 style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>💬 Team Chat</h2>
          {currentChannel && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
              {currentChannel.name}
              {currentChannel.type === 'task' && ' • Task Discussion'}
              {currentChannel.type === 'persona' && ' • Direct Message'}
            </p>
          )}
        </div>
        <button onClick={onClose} title="Close chat"
          style={{ padding: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', borderRadius: '0.25rem' }}>
          ✕
        </button>
      </div>

      {/* Channel Switcher */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', alignItems: 'center' }}>
          {/* DM with Persona button */}
          {onCreatePersonaChannel && (
            <button
              onClick={() => setShowPersonaList(!showPersonaList)}
              style={{
                padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem',
                whiteSpace: 'nowrap', border: '1px dashed var(--border)', cursor: 'pointer',
                background: showPersonaList ? 'var(--accent)' : 'transparent',
                color: showPersonaList ? '#fff' : 'var(--text-muted)',
              }}
              title="Start a direct conversation with a persona"
            >
              ➕ DM
            </button>
          )}
          {channels.map(channel => {
            const icon = channel.type === 'general' ? '🏠' : channel.type === 'persona' ? '💬' : '📋';
            return (
              <button key={channel.id} onClick={() => { onSwitchChannel(channel); setShowPersonaList(false); }}
                style={{
                  padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem',
                  whiteSpace: 'nowrap', border: 'none', cursor: 'pointer',
                  background: currentChannel?.id === channel.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: currentChannel?.id === channel.id ? '#fff' : 'var(--text-secondary)'
                }}>
                {icon} {channel.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Persona DM List */}
      {showPersonaList && onCreatePersonaChannel && (
        <div style={{
          padding: '0.75rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-tertiary)',
        }}>
          <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Start a direct conversation:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {personas.map(persona => (
              <button
                key={persona.id}
                onClick={async () => {
                  const channel = await onCreatePersonaChannel(persona.id, persona.name, persona.emoji);
                  onSwitchChannel(channel);
                  setShowPersonaList(false);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.4rem 0.75rem', borderRadius: '0.5rem',
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
                  cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.borderColor = 'var(--accent)';
                  (e.target as HTMLElement).style.background = 'var(--bg-secondary)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.borderColor = 'var(--border)';
                  (e.target as HTMLElement).style.background = 'var(--bg-primary)';
                }}
              >
                <span style={{ fontSize: '1rem' }}>{persona.emoji}</span>
                <span>{persona.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {!currentChannel && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
            <p>Select a channel to start chatting</p>
          </div>
        )}
        
        {currentChannel?.messages.map(message => (
          <div key={message.id} className="chat-message-group">
            {message.replyTo && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', paddingLeft: '1rem', borderLeft: '2px solid var(--accent)', opacity: 0.6 }}>
                Replying to previous message
              </div>
            )}
            
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{
                width: '2.25rem', height: '2.25rem', background: 'var(--bg-tertiary)', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
                flexShrink: 0, color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: '500'
              }}>
                {message.authorType === 'persona' 
                  ? personas.find(p => p.name === message.author)?.emoji || '🤖'
                  : message.author[0]?.toUpperCase()
                }
              </div>
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    {message.authorType === 'persona' 
                      ? personas.find(p => p.name === message.author)?.name || message.author
                      : message.author
                    }
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {formatTimestamp(message.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', wordBreak: 'break-word', lineHeight: '1.5' }}>
                  {formatMessageContent(message.content)}
                </div>
              </div>
              
              <button onClick={() => setReplyToMessage(message)} className="chat-reply-btn"
                style={{ padding: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', opacity: 0, fontSize: '0.8rem', color: 'var(--text-muted)', borderRadius: '0.25rem', transition: 'all 0.2s' }}
                title="Reply"
                onMouseEnter={(e) => { e.target.style.background = 'var(--bg-tertiary)'; e.target.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.target.style.background = 'none'; e.target.style.color = 'var(--text-muted)'; }}>
                ↩️
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply indicator */}
      {replyToMessage && (
        <div style={{
          padding: '1rem', background: 'rgba(59, 130, 246, 0.08)',
          borderTop: '1px solid var(--border)', borderLeft: '3px solid var(--accent)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}>
              Replying to <strong style={{ color: 'var(--accent)' }}>{replyToMessage.author}</strong>
            </span>
            <button onClick={() => setReplyToMessage(null)}
              style={{ 
                background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', 
                fontSize: '0.875rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => { e.target.style.background = 'rgba(59, 130, 246, 0.1)'; }}
              onMouseLeave={(e) => { e.target.style.background = 'none'; }}>
              ✕ Cancel
            </button>
          </div>
          <div style={{ 
            color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap', fontSize: '0.8rem', fontStyle: 'italic'
          }}>
            {formatMessageContent(replyToMessage.content)}
          </div>
        </div>
      )}

      {/* Mention suggestions */}
      {showMentionSuggestions && mentionSuggestions.length > 0 && (
        <div style={{ padding: '0 1rem' }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: '0.75rem', maxHeight: '10rem', overflowY: 'auto',
            boxShadow: '0 -8px 16px rgba(0,0,0,0.15)', marginBottom: '0.5rem'
          }}>
            {mentionSuggestions.map(persona => (
              <button key={persona.id} onClick={() => handleMentionSelect(persona)}
                style={{
                  width: '100%', padding: '0.75rem', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
                  borderRadius: '0.5rem', margin: '0.25rem', transition: 'background 0.15s'
                }}
                className="chat-mention-option"
                onMouseEnter={(e) => { e.target.style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.target.style.background = 'none'; }}>
                <span style={{ fontSize: '1.1rem' }}>{persona.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{persona.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                    {persona.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message Input */}
      <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        {currentChannel && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <textarea ref={inputRef} value={messageInput}
              onChange={(e) => { setMessageInput(e.target.value); setCursorPosition(e.target.selectionStart); }}
              onKeyDown={handleKeyDown}
              onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
              placeholder="Type a message... Use @name to mention"
              rows={2}
              style={{
                flex: 1, background: 'var(--bg-primary)', border: '2px solid var(--border)',
                borderRadius: '0.75rem', padding: '0.75rem', resize: 'none',
                color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none',
                transition: 'border-color 0.2s', lineHeight: '1.4'
              }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
            />
            <button onClick={handleSendMessage} disabled={!messageInput.trim()}
              style={{
                padding: '0.75rem 1.25rem', background: messageInput.trim() ? 'var(--accent)' : 'var(--bg-tertiary)', 
                color: messageInput.trim() ? '#fff' : 'var(--text-muted)',
                borderRadius: '0.75rem', border: 'none', cursor: messageInput.trim() ? 'pointer' : 'not-allowed', 
                fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.2s',
                minWidth: '4rem', height: '2.75rem'
              }}
              onMouseEnter={(e) => { if (messageInput.trim()) e.target.style.background = 'var(--accent-hover)'; }}
              onMouseLeave={(e) => { if (messageInput.trim()) e.target.style.background = 'var(--accent)'; }}>
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
