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
  isOpen, 
  onClose, 
  currentChannel, 
  channels, 
  personas,
  currentUser,
  onSendMessage,
  onSwitchChannel,
  onCreateTaskChannel 
}: ChatPanelProps) {
  const [messageInput, setMessageInput] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Persona[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChannel?.messages]);

  // Handle @mention autocomplete
  useEffect(() => {
    if (messageInput.includes('@')) {
      const atIndex = messageInput.lastIndexOf('@', cursorPosition);
      if (atIndex !== -1) {
        const query = messageInput.slice(atIndex + 1, cursorPosition);
        if (query.length >= 0 && !query.includes(' ')) {
          setMentionQuery(query);
          setMentionSuggestions(
            personas.filter(persona => 
              persona.name.toLowerCase().includes(query.toLowerCase())
            )
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    } else if (e.key === 'Escape') {
      setReplyToMessage(null);
    }
  };

  const handleMentionSelect = (persona: Persona) => {
    const atIndex = messageInput.lastIndexOf('@', cursorPosition);
    const newMessage = 
      messageInput.slice(0, atIndex + 1) + 
      persona.name + ' ' + 
      messageInput.slice(cursorPosition);
    
    setMessageInput(newMessage);
    setShowMentionSuggestions(false);
    setCursorPosition(atIndex + persona.name.length + 2);
    
    // Focus back on input
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const formatMessageContent = (content: string): JSX.Element => {
    // Replace @mentions with highlighted spans
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const parts = content.split(mentionRegex);
    
    return (
      <span>
        {parts.map((part, index) => {
          if (index % 2 === 1) {
            // This is a mention
            const persona = personas.find(p => p.name === part);
            return (
              <span 
                key={index}
                className="bg-blue-100 text-blue-800 px-1 rounded font-medium"
                title={persona ? `${persona.emoji} ${persona.description}` : undefined}
              >
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
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return new Date(date).toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l shadow-lg z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">💬 Team Chat</h2>
          {currentChannel && (
            <p className="text-sm text-gray-600">
              {currentChannel.name}
              {currentChannel.type === 'task' && ' • Task Discussion'}
            </p>
          )}
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-gray-200 rounded"
          title="Close chat"
        >
          ✕
        </button>
      </div>

      {/* Channel Switcher */}
      <div className="p-3 border-b bg-gray-25">
        <div className="flex gap-2 overflow-x-auto">
          {channels.map(channel => (
            <button
              key={channel.id}
              onClick={() => onSwitchChannel(channel)}
              className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${
                currentChannel?.id === channel.id 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              {channel.type === 'general' ? '🏠' : '📋'} {channel.name}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!currentChannel && (
          <div className="text-center text-gray-500 mt-8">
            <p>Select a channel to start chatting</p>
          </div>
        )}
        
        {currentChannel?.messages.map(message => (
          <div key={message.id} className="group">
            {message.replyTo && (
              <div className="text-xs text-gray-400 mb-1 pl-4 border-l-2 border-gray-200">
                Replying to previous message
              </div>
            )}
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-sm font-medium">
                {message.authorType === 'persona' 
                  ? personas.find(p => p.name === message.author)?.emoji || '🤖'
                  : message.author[0]?.toUpperCase()
                }
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {message.authorType === 'persona' 
                      ? personas.find(p => p.name === message.author)?.name || message.author
                      : message.author
                    }
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(message.createdAt)}
                  </span>
                </div>
                
                <div className="text-sm mt-1 break-words">
                  {formatMessageContent(message.content)}
                </div>
              </div>
              
              <button
                onClick={() => setReplyToMessage(message)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded text-xs"
                title="Reply"
              >
                ↩️
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply indicator */}
      {replyToMessage && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-200 text-sm">
          <div className="flex items-center justify-between">
            <span>Replying to <strong>{replyToMessage.author}</strong></span>
            <button 
              onClick={() => setReplyToMessage(null)}
              className="text-blue-600 hover:text-blue-800"
            >
              Cancel
            </button>
          </div>
          <div className="text-gray-600 truncate">
            {formatMessageContent(replyToMessage.content)}
          </div>
        </div>
      )}

      {/* Mention suggestions */}
      {showMentionSuggestions && mentionSuggestions.length > 0 && (
        <div className="px-4">
          <div className="bg-white border rounded-lg shadow-lg max-h-32 overflow-y-auto">
            {mentionSuggestions.map(persona => (
              <button
                key={persona.id}
                onClick={() => handleMentionSelect(persona)}
                className="w-full p-2 hover:bg-gray-100 text-left flex items-center gap-2"
              >
                <span>{persona.emoji}</span>
                <div>
                  <div className="font-medium text-sm">{persona.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {persona.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="p-4 border-t">
        {currentChannel && (
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={messageInput}
              onChange={(e) => {
                setMessageInput(e.target.value);
                setCursorPosition(e.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
              placeholder="Type a message... Use @name to mention personas"
              className="flex-1 border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}