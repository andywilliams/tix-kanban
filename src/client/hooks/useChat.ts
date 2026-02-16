import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatChannel, ChatMessage } from '../types';

interface UseChatReturn {
  channels: ChatChannel[];
  currentChannel: ChatChannel | null;
  loading: boolean;
  error: string | null;
  switchChannel: (channel: ChatChannel) => void;
  sendMessage: (channelId: string, content: string, replyTo?: string) => Promise<void>;
  createTaskChannel: (taskId: string, taskTitle: string) => Promise<ChatChannel>;
  refreshChannels: () => Promise<void>;
  refreshMessages: (channelId: string) => Promise<void>;
}

export function useChat(): UseChatReturn {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<ChatChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messagePolling, setMessagePolling] = useState<NodeJS.Timeout | null>(null);
  const mentionPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch all channels
  const refreshChannels = useCallback(async () => {
    try {
      const response = await fetch('/api/chat/channels');
      if (!response.ok) {
        throw new Error('Failed to fetch channels');
      }
      const data = await response.json();
      setChannels(data.channels.map((channel: any) => ({
        ...channel,
        lastActivity: new Date(channel.lastActivity),
        messages: channel.messages.map((msg: any) => ({
          ...msg,
          createdAt: new Date(msg.createdAt)
        }))
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Fetch messages for a specific channel
  const refreshMessages = useCallback(async (channelId: string) => {
    try {
      const response = await fetch(`/api/chat/${channelId}/messages`);
      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }
      const data = await response.json();
      
      // Update the channel with new messages
      setChannels(prev => prev.map(channel => {
        if (channel.id === channelId) {
          return {
            ...channel,
            messages: data.messages.map((msg: any) => ({
              ...msg,
              createdAt: new Date(msg.createdAt)
            }))
          };
        }
        return channel;
      }));
      
      // Update current channel if it matches
      if (currentChannel?.id === channelId) {
        setCurrentChannel(prev => prev ? {
          ...prev,
          messages: data.messages.map((msg: any) => ({
            ...msg,
            createdAt: new Date(msg.createdAt)
          }))
        } : null);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  }, [currentChannel]);

  // Send a message
  const sendMessage = useCallback(async (channelId: string, content: string, replyTo?: string) => {
    try {
      const response = await fetch(`/api/chat/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          author: 'User', // TODO: Get actual user name
          authorType: 'human',
          content,
          replyTo
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Refresh messages for this channel immediately
      await refreshMessages(channelId);
      
      // If message contains @mentions, poll more frequently for persona responses
      if (content.includes('@')) {
        // Clear any existing mention polling
        if (mentionPollingRef.current) {
          clearInterval(mentionPollingRef.current);
          mentionPollingRef.current = null;
        }
        
        // Poll every 500ms for 10 seconds to catch persona responses quickly
        let pollCount = 0;
        const maxPolls = 20; // 10 seconds at 500ms intervals
        
        mentionPollingRef.current = setInterval(async () => {
          pollCount++;
          await refreshMessages(channelId);
          
          if (pollCount >= maxPolls) {
            // Capture ref value to avoid race condition between check and clear
            const interval = mentionPollingRef.current;
            if (interval) {
              clearInterval(interval);
            }
            mentionPollingRef.current = null;
          }
        }, 500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err;
    }
  }, [refreshMessages]);

  // Switch to a different channel
  const switchChannel = useCallback(async (channel: ChatChannel) => {
    setCurrentChannel(channel);
    
    // Stop polling previous channel
    if (messagePolling) {
      clearInterval(messagePolling);
    }
    
    // Start polling new channel for updates
    const interval = setInterval(() => {
      refreshMessages(channel.id);
    }, 2000);
    setMessagePolling(interval);
    
    // Initial refresh
    await refreshMessages(channel.id);
  }, [refreshMessages, messagePolling]);

  // Create a task-specific channel
  const createTaskChannel = useCallback(async (taskId: string, taskTitle: string): Promise<ChatChannel> => {
    try {
      const channelId = `task-${taskId}`;
      const response = await fetch(`/api/chat/${channelId}?type=task&taskId=${taskId}&name=${encodeURIComponent(taskTitle)}`);
      
      if (!response.ok) {
        throw new Error('Failed to create task channel');
      }
      
      const data = await response.json();
      const channel = {
        ...data.channel,
        lastActivity: new Date(data.channel.lastActivity),
        messages: data.channel.messages.map((msg: any) => ({
          ...msg,
          createdAt: new Date(msg.createdAt)
        }))
      };
      
      // Add to channels list if not already present
      setChannels(prev => {
        const exists = prev.find(c => c.id === channelId);
        if (exists) return prev;
        return [channel, ...prev];
      });
      
      return channel;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task channel');
      throw err;
    }
  }, []);

  // Initialize - fetch channels and create/switch to general channel
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        await refreshChannels();
        
        // Get or create general channel
        const generalResponse = await fetch('/api/chat/general?type=general&name=General');
        if (generalResponse.ok) {
          const data = await generalResponse.json();
          const generalChannel = {
            ...data.channel,
            lastActivity: new Date(data.channel.lastActivity),
            messages: data.channel.messages.map((msg: any) => ({
              ...msg,
              createdAt: new Date(msg.createdAt)
            }))
          };
          
          // Add general channel if not in list
          setChannels(prev => {
            const exists = prev.find(c => c.id === 'general');
            if (exists) return prev;
            return [generalChannel, ...prev];
          });
          
          // Switch to general channel by default
          setCurrentChannel(generalChannel);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize chat');
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [refreshChannels]);

  // Cleanup message polling when it changes
  useEffect(() => {
    return () => {
      if (messagePolling) {
        clearInterval(messagePolling);
      }
    };
  }, [messagePolling]);

  // Cleanup mention polling only on component unmount
  useEffect(() => {
    return () => {
      if (mentionPollingRef.current) {
        clearInterval(mentionPollingRef.current);
        mentionPollingRef.current = null;
      }
    };
  }, []); // Empty dependency array = only runs on unmount

  return {
    channels,
    currentChannel,
    loading,
    error,
    switchChannel,
    sendMessage,
    createTaskChannel,
    refreshChannels,
    refreshMessages
  };
}