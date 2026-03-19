import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ChatChannel, ChatMessage, Persona, Task } from '../types';
import TypingIndicator from './chat/TypingIndicator';
import ToolResultRenderer from './chat/ToolResultRenderer';
import TicketPreviewCard from './chat/TicketPreviewCard';
import BoardSummary from './chat/BoardSummary';

// Animation keyframes
const keyframes = `
  @keyframes typing {
    0% { opacity: 0.2; }
    20% { opacity: 1; }
    100% { opacity: 0.2; }
  }
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
`;

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentChannel: ChatChannel | null;
  channels: ChatChannel[];
  personas: Persona[];
  currentUser: string;
  tasks?: Task[]; // For /board command
  onSendMessage: (channelId: string, content: string, replyTo?: string) => void;
  onSwitchChannel: (channel: ChatChannel) => void;
  onCreateTaskChannel: (taskId: string, taskTitle: string) => void;
  onCreatePersonaChannel?: (personaId: string, personaName: string, personaEmoji: string) => Promise<ChatChannel>;
  // Streaming support
  streamingMessageId?: string | null;
  streamingText?: string;
  isThinking?: boolean;
  streamingChannelId?: string | null;
}

interface PendingTicket {
  title: string;
  description: string;
  priority: number;
  assignee?: string;
  tags?: string[];
}

export default function ChatPanel({ 
  isOpen, onClose, currentChannel, channels, personas, currentUser, tasks = [],
  onSendMessage, onSwitchChannel, onCreateTaskChannel, onCreatePersonaChannel,
  streamingMessageId, streamingText, isThinking, streamingChannelId
}: ChatPanelProps) {
  const [showPersonaList, setShowPersonaList] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Persona[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [pendingTicket, setPendingTicket] = useState<PendingTicket | null>(null);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const [newMessagesIndicator, setNewMessagesIndicator] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevMessagesLengthRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);
  const prevChannelIdRef = useRef<string | null>(null);

  // Inject animation keyframes into DOM once on mount
  useEffect(() => {
    const styleId = 'chat-panel-animation-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = keyframes;
      document.head.appendChild(style);
    }
  }, []);

  // Reset scroll state when channel changes
  useEffect(() => {
    setNewMessagesIndicator(false);
    isAtBottomRef.current = true;
    prevMessagesLengthRef.current = 0;
  }, [currentChannel?.id]);

  // Instant scroll on initial load and channel switch (before paint, no flash)
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    const isChannelSwitch = prevChannelIdRef.current !== null && prevChannelIdRef.current !== currentChannel?.id;
    const isInitialLoad = prevChannelIdRef.current === null;
    
    if (isInitialLoad || isChannelSwitch) {
      // Instant scroll - runs synchronously before browser paints
      container.scrollTop = container.scrollHeight;
    }
    
    prevChannelIdRef.current = currentChannel?.id || null;
  }, [currentChannel?.id]);

  // Detect scroll position and track if user has scrolled up
  const checkIsAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    
    const threshold = 50; // pixels from bottom to consider "at bottom"
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    return isAtBottom;
  }, []);

  // Handle scroll event to detect when user manually scrolls up
  const handleScroll = useCallback(() => {
    const isAtBottom = checkIsAtBottom();
    isAtBottomRef.current = isAtBottom;
    
    // Hide new messages indicator when user scrolls to bottom
    if (isAtBottom) {
      setNewMessagesIndicator(false);
    }
  }, [checkIsAtBottom]);

  // Smart scroll effect: only auto-scroll when user is at bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !currentChannel?.messages) return;
    
    const currentLength = currentChannel.messages.length;
    const prevLength = prevMessagesLengthRef.current;
    const newMessagesArrived = currentLength > prevLength;
    
    if (newMessagesArrived) {
      // Check if user was at bottom before the new messages
      const wasAtBottom = isAtBottomRef.current;
      
      if (wasAtBottom) {
        // User is at bottom - auto-scroll to show new message
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        // User has scrolled up - show indicator, don't scroll
        setNewMessagesIndicator(true);
      }
    }
    
    prevMessagesLengthRef.current = currentLength;
  }, [currentChannel?.messages]);

  // Initialize scroll tracking on container mount
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll);
    // Initial check
    isAtBottomRef.current = checkIsAtBottom();
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll, checkIsAtBottom, isOpen]);

  // Slash command detection
  useEffect(() => {
    if (messageInput.startsWith('/')) {
      setShowSlashCommands(true);
    } else {
      setShowSlashCommands(false);
    }
  }, [messageInput]);

  // @mention detection
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

  const handleSlashCommand = (command: string) => {
    const cmd = command.toLowerCase().trim();
    
    if (cmd === '/board') {
      // Insert board summary in chat
      setMessageInput('');
      setShowSlashCommands(false);
      setReplyToMessage(null);
      // Send a special message that will render BoardSummary
      onSendMessage(currentChannel!.id, '📊 /board', replyToMessage?.id);
      return;
    }
    
    if (cmd === '/status') {
      // Show current channel status
      setMessageInput('');
      setShowSlashCommands(false);
      setReplyToMessage(null);
      onSendMessage(currentChannel!.id, '📊 /status', replyToMessage?.id);
      return;
    }
    
    if (cmd.startsWith('/create ')) {
      // Quick ticket creation - extract title from ORIGINAL input, not lowercased
      const title = command.substring(8).trim();
      if (title) {
        setPendingTicket({
          title,
          description: 'Created via /create command',
          priority: 400, // Normal priority
        });
      }
      setMessageInput('');
      setShowSlashCommands(false);
      setReplyToMessage(null);
      return;
    }
    
    // Unknown command - send as regular message
    setMessageInput('');
    setShowSlashCommands(false);
    setReplyToMessage(null);
    onSendMessage(currentChannel!.id, command, replyToMessage?.id);
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !currentChannel) return;
    
    // Check for slash commands
    if (messageInput.startsWith('/')) {
      handleSlashCommand(messageInput);
      return;
    }
    
    onSendMessage(currentChannel.id, messageInput.trim(), replyToMessage?.id);
    setMessageInput('');
    setReplyToMessage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      handleSendMessage(); 
    }
    else if (e.key === 'Escape') {
      setReplyToMessage(null);
      setPendingTicket(null);
    }
  };

  const handleMentionSelect = (persona: Persona) => {
    const atIndex = messageInput.lastIndexOf('@', cursorPosition);
    const newMessage = messageInput.slice(0, atIndex + 1) + persona.name + ' ' + messageInput.slice(cursorPosition);
    setMessageInput(newMessage);
    setShowMentionSuggestions(false);
    setCursorPosition(atIndex + persona.name.length + 2);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const formatTimestamp = (date: Date): string => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return new Date(date).toLocaleDateString();
  };

  const handleConfirmTicket = () => {
    if (pendingTicket && currentChannel) {
      // Send a message to create the ticket
      const message = `Create ticket: "${pendingTicket.title}" with priority ${pendingTicket.priority}`;
      onSendMessage(currentChannel.id, message);
      setPendingTicket(null);
    }
  };

  const slashCommands = [
    { command: '/create <title>', description: 'Quick ticket creation' },
    { command: '/board', description: 'Show board summary' },
    { command: '/status', description: 'Show channel status' },
  ];

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
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-secondary)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-primary)';
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
      <div ref={messagesContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {!currentChannel && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
            <p>Select a channel to start chatting</p>
          </div>
        )}
        
        {currentChannel?.messages.map(message => {
          // Check for special board command
          if (message.content === '📊 /board') {
            return (
              <div key={message.id}>
                <BoardSummary tasks={tasks} />
              </div>
            );
          }

          return (
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
                    <ToolResultRenderer content={message.content} personas={personas} />
                  </div>
                </div>
                
                <button onClick={() => setReplyToMessage(message)} className="chat-reply-btn"
                  style={{ padding: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', opacity: 0, fontSize: '0.8rem', color: 'var(--text-muted)', borderRadius: '0.25rem', transition: 'all 0.2s' }}
                  title="Reply"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                  ↩️
                </button>
              </div>
            </div>
          );
        })}
        
        {/* Streaming message (in-progress response) */}
        {streamingMessageId && streamingText && streamingChannelId === currentChannel?.id && (
          <div className="chat-message-group streaming-message">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{
                width: '2.25rem', height: '2.25rem', background: 'var(--bg-tertiary)', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
                flexShrink: 0, color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: '500'
              }}>
                🤖
              </div>
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    AI Response
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    streaming...
                  </span>
                </div>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: 'var(--text-secondary)', 
                  wordBreak: 'break-word', 
                  lineHeight: '1.5',
                  opacity: 0.9
                }}>
                  {streamingText}
                  <span style={{ 
                    animation: 'blink 1s infinite',
                    marginLeft: '2px'
                  }}>▌</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Typing indicator (thinking state) */}
        {(
          (isThinking && streamingChannelId === currentChannel?.id && !streamingText) ||
          (currentChannel?.speakingPersona && streamingChannelId !== currentChannel?.id)
        ) && (() => {
          const persona = personas.find(p => p.id === currentChannel?.speakingPersona);
          return persona ? <TypingIndicator persona={persona} /> : (
            <TypingIndicator persona={{ 
              id: 'thinking', 
              name: 'AI', 
              emoji: '🤖', 
              description: '', 
              specialties: [], 
              model: '', 
              thinkingMode: 'low' 
            }} />
          );
        })()}

        {/* Pending ticket preview */}
        {pendingTicket && (
          <TicketPreviewCard
            ticket={pendingTicket}
            onConfirm={handleConfirmTicket}
            onCancel={() => setPendingTicket(null)}
          />
        )}
        
        {/* New messages indicator - shows when user has scrolled up and new messages arrive */}
        {newMessagesIndicator && (
          <button
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              setNewMessagesIndicator(false);
            }}
            style={{
              position: 'sticky',
              bottom: '0.5rem',
              alignSelf: 'center',
              padding: '0.5rem 1rem',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '9999px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.2s',
              zIndex: 10,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
          >
            ↓ New message
          </button>
        )}
        
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
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
              ✕ Cancel
            </button>
          </div>
          <div style={{ 
            color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap', fontSize: '0.8rem', fontStyle: 'italic'
          }}>
            <ToolResultRenderer content={replyToMessage.content} personas={personas} />
          </div>
        </div>
      )}

      {/* Slash command suggestions */}
      {showSlashCommands && (
        <div style={{ padding: '0 1rem' }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: '0.75rem', maxHeight: '10rem', overflowY: 'auto',
            boxShadow: '0 -8px 16px rgba(0,0,0,0.15)', marginBottom: '0.5rem'
          }}>
            {slashCommands.map(cmd => (
              <button key={cmd.command} onClick={() => { setMessageInput(cmd.command.split('<')[0].trim()); inputRef.current?.focus(); }}
                style={{
                  width: '100%', padding: '0.75rem', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', gap: '0.25rem',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
                  borderRadius: '0.5rem', margin: '0.25rem', transition: 'background 0.15s'
                }}
                className="chat-slash-option"
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 600 }}>{cmd.command}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cmd.description}</div>
              </button>
            ))}
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
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
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
              placeholder="Type a message... Use @name to mention or /command"
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
              onMouseEnter={(e) => { if (messageInput.trim()) e.currentTarget.style.background = 'var(--accent-hover)'; }}
              onMouseLeave={(e) => { if (messageInput.trim()) e.currentTarget.style.background = 'var(--accent)'; }}>
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
