import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatChannel, ChatMessage } from '../types';

export interface ChatNotification {
  id: string;
  channelId: string;
  channelName: string;
  author: string;
  content: string;
  timestamp: Date;
}

interface UseChatReturn {
  channels: ChatChannel[];
  currentChannel: ChatChannel | null;
  loading: boolean;
  error: string | null;
  unreadCounts: Record<string, number>;
  totalUnread: number;
  notifications: ChatNotification[];
  dismissNotification: (id: string) => void;
  switchChannel: (channel: ChatChannel) => void;
  sendMessage: (channelId: string, content: string, replyTo?: string) => Promise<void>;
  createTaskChannel: (taskId: string, taskTitle: string) => Promise<ChatChannel>;
  createPersonaChannel: (personaId: string, personaName: string, personaEmoji: string) => Promise<ChatChannel>;
  refreshChannels: () => Promise<void>;
  refreshMessages: (channelId: string) => Promise<void>;
}

export function useChat(currentUser: string = 'User'): UseChatReturn {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<ChatChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messagePolling, setMessagePolling] = useState<NodeJS.Timeout | null>(null);
  const mentionPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Notification tracking
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [notifications, setNotifications] = useState<ChatNotification[]>([]);
  // Track last-seen message count per channel to detect new persona messages
  const lastSeenCountsRef = useRef<Record<string, number>>({});
  const initialLoadDoneRef = useRef(false);
  const currentChannelRef = useRef<ChatChannel | null>(null);

  // Keep refs in sync
  useEffect(() => { currentChannelRef.current = currentChannel; }, [currentChannel]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Fetch all channels and detect new persona messages
  const refreshChannels = useCallback(async () => {
    try {
      const response = await fetch('/api/chat/channels');
      if (!response.ok) {
        throw new Error('Failed to fetch channels');
      }
      const data = await response.json();
      const updatedChannels: ChatChannel[] = data.channels.map((channel: any) => ({
        ...channel,
        lastActivity: new Date(channel.lastActivity),
        messages: channel.messages.map((msg: any) => ({
          ...msg,
          createdAt: new Date(msg.createdAt)
        }))
      }));

      // Detect new persona messages across all channels
      const newNotifications: ChatNotification[] = [];
      const newUnreads: Record<string, number> = {};

      for (const channel of updatedChannels) {
        const isActiveChannel = currentChannelRef.current?.id === channel.id;
        const isKnownChannel = lastSeenCountsRef.current[channel.id] !== undefined;

        if (!initialLoadDoneRef.current) {
          // First load — initialize all channels as fully read (no notification flood)
          lastSeenCountsRef.current[channel.id] = channel.messages.length;
          continue;
        }

        if (!isKnownChannel) {
          // New channel appeared since initial load — treat existing messages as new
          lastSeenCountsRef.current[channel.id] = 0;
        }

        const lastSeen = lastSeenCountsRef.current[channel.id];
        const newMessages = channel.messages.slice(lastSeen);
        const newPersonaMessages = newMessages.filter((m: ChatMessage) => m.authorType === 'persona');

        if (!isActiveChannel && newPersonaMessages.length > 0) {
          // Count unreads
          newUnreads[channel.id] = (newUnreads[channel.id] || 0) + newPersonaMessages.length;

          // Create toast notifications
          for (const msg of newPersonaMessages) {
            newNotifications.push({
              id: msg.id,
              channelId: channel.id,
              channelName: channel.name,
              author: msg.author,
              content: msg.content.length > 120 ? msg.content.substring(0, 120) + '...' : msg.content,
              timestamp: new Date(msg.createdAt),
            });
          }
        }

        // Always advance lastSeen to current count so we don't re-notify
        lastSeenCountsRef.current[channel.id] = channel.messages.length;
      }

      initialLoadDoneRef.current = true;

      if (newNotifications.length > 0) {
        setNotifications(prev => [...prev, ...newNotifications].slice(-10)); // Keep last 10
      }
      if (Object.keys(newUnreads).length > 0) {
        setUnreadCounts(prev => {
          const updated = { ...prev };
          for (const [chId, count] of Object.entries(newUnreads)) {
            updated[chId] = (updated[chId] || 0) + count;
          }
          return updated;
        });
      }

      setChannels(updatedChannels);
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
      const messages = data.messages.map((msg: any) => ({
        ...msg,
        createdAt: new Date(msg.createdAt)
      }));

      // If this is the active channel, mark messages as seen and clear unreads
      if (currentChannelRef.current?.id === channelId) {
        lastSeenCountsRef.current[channelId] = messages.length;
        setUnreadCounts(prev => {
          if (!prev[channelId]) return prev;
          const updated = { ...prev };
          delete updated[channelId];
          return updated;
        });
      }

      // Update the channel with new messages
      setChannels(prev => prev.map(channel => {
        if (channel.id === channelId) {
          return { ...channel, messages };
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
          author: currentUser,
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
      
      // Poll more frequently after sending to catch persona responses
      // Triggers for @mentions OR direct persona channels (no @ needed)
      const isDirectChannel = channelId.startsWith('direct-');
      if (content.includes('@') || isDirectChannel) {
        // Clear any existing mention polling
        if (mentionPollingRef.current) {
          clearInterval(mentionPollingRef.current);
          mentionPollingRef.current = null;
        }
        
        // Poll every 1s for 30 seconds to catch AI responses (Claude Code can take 10-20s)
        let pollCount = 0;
        const maxPolls = 30;
        
        mentionPollingRef.current = setInterval(async () => {
          pollCount++;
          await refreshMessages(channelId);
          
          if (pollCount >= maxPolls) {
            const interval = mentionPollingRef.current;
            if (interval) {
              clearInterval(interval);
            }
            mentionPollingRef.current = null;
          }
        }, 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err;
    }
  }, [refreshMessages, currentUser]);

  // Switch to a different channel
  const switchChannel = useCallback(async (channel: ChatChannel) => {
    setCurrentChannel(channel);

    // Clear unread count for this channel
    setUnreadCounts(prev => {
      const updated = { ...prev };
      delete updated[channel.id];
      return updated;
    });
    // Mark all messages as seen
    lastSeenCountsRef.current[channel.id] = channel.messages.length;

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

  // Create a direct persona channel (DM with a persona)
  const createPersonaChannel = useCallback(async (personaId: string, personaName: string, personaEmoji: string): Promise<ChatChannel> => {
    try {
      const channelId = `persona-${personaId}`;
      const channelName = `${personaEmoji} ${personaName}`;
      const response = await fetch(`/api/chat/${channelId}?type=persona&personaId=${personaId}&name=${encodeURIComponent(channelName)}`);
      
      if (!response.ok) {
        throw new Error('Failed to create persona channel');
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
      setError(err instanceof Error ? err.message : 'Failed to create persona channel');
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

  // Background polling for all channels to detect new persona messages
  useEffect(() => {
    const interval = setInterval(() => {
      refreshChannels();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshChannels]);

  const totalUnread = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);

  return {
    channels,
    currentChannel,
    loading,
    error,
    unreadCounts,
    totalUnread,
    notifications,
    dismissNotification,
    switchChannel,
    sendMessage,
    createTaskChannel,
    createPersonaChannel,
    refreshChannels,
    refreshMessages
  };
}