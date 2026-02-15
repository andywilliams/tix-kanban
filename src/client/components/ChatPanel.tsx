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
}

export default function ChatPanel({ 
  isOpen, onClose, currentChannel, channels, personas, currentUser,
  onSendMessage, onSwitchChannel, onCreateTaskChannel 
}: ChatPanelProps) {
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
                background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent)',
                padding: '0 0.25rem', borderRadius: '0.2rem', fontWeight: 500
              }} title={persona ? `${persona.emoji} ${persona.description}` : undefined}>
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
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
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
        {!currentChannel && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
            <p>Select a channel to start chatting</p>
          </div>
        )}
        
        {currentChannel?.messages.map(message => (
          <div key={message.id} className="chat-message-group">
            {message.replyTo && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>
                Replying to previous message
              </div>
            )}
            
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div style={{
                width: '2rem', height: '2rem', background: 'var(--bg-tertiary)', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
                flexShrink: 0, color: 'var(--text-primary)'
              }}>
                {message.authorType === 'persona' 
                  ? personas.find(p => p.name === message.author)?.emoji || '🤖'
                  : message.author[0]?.toUpperCase()
                }
              </div>
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    {message.authorType === 'persona' 
                      ? personas.find(p => p.name === message.author)?.name || message.author
                      : message.author
                    }
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {formatTimestamp(message.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                  {formatMessageContent(message.content)}
                </div>
              </div>
              
              <button onClick={() => setReplyToMessage(message)} className="chat-reply-btn"
                style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', opacity: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}
                title="Reply">
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
          padding: '0.5rem 1rem', background: 'rgba(59, 130, 246, 0.1)',
          borderTop: '1px solid var(--border)', fontSize: '0.8rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Replying to <strong>{replyToMessage.author}</strong></span>
            <button onClick={() => setReplyToMessage(null)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Cancel
            </button>
          </div>
          <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatMessageContent(replyToMessage.content)}
          </div>
        </div>
      )}

      {/* Mention suggestions */}
      {showMentionSuggestions && mentionSuggestions.length > 0 && (
        <div style={{ padding: '0 1rem' }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: '0.5rem', maxHeight: '8rem', overflowY: 'auto',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.2)'
          }}>
            {mentionSuggestions.map(persona => (
              <button key={persona.id} onClick={() => handleMentionSelect(persona)}
                style={{
                  width: '100%', padding: '0.5rem', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)'
                }}
                className="chat-mention-option">
                <span>{persona.emoji}</span>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{persona.name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {persona.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message Input */}
      <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
        {currentChannel && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea ref={inputRef} value={messageInput}
              onChange={(e) => { setMessageInput(e.target.value); setCursorPosition(e.target.selectionStart); }}
              onKeyDown={handleKeyDown}
              onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
              placeholder="Type a message... Use @name to mention"
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
        )}
      </div>
    </div>
  );
}
