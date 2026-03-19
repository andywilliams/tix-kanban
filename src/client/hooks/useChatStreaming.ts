import { useState, useCallback, useRef } from 'react';

/**
 * Hook for SSE streaming chat responses
 * Provides token-by-token streaming with graceful fallback to polling
 */
export function useChatStreaming() {
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [streamingChannelId, setStreamingChannelId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamIdRef = useRef<number>(0); // Track stream session to guard against race conditions
  const streamCompletedRef = useRef<boolean>(false); // Track if stream completed successfully via 'done' event

  const cancelStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStreamingMessageId(null);
    setStreamingText('');
    setIsThinking(false);
    setStreamingChannelId(null);
  }, []);

  const startStream = useCallback((
    channelId: string,
    messageId: string,
    personaId: string,
    onComplete: (messageId: string, fullText: string) => void,
    onError?: (error: string) => void
  ) => {
    // Cancel any existing stream
    cancelStream();
    
    // Increment stream ID to track this session
    const currentStreamId = ++streamIdRef.current;
    
    // Reset completion flag for the new stream
    streamCompletedRef.current = false;
    
    // Set the channel ID for this stream
    setStreamingChannelId(channelId);

    // Build SSE URL
    const url = `/api/chat/${channelId}/stream?messageId=${encodeURIComponent(messageId)}&personaId=${encodeURIComponent(personaId)}`;

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('thinking', () => {
        console.log('📡 SSE: Persona is thinking...');
        setIsThinking(true);
        setStreamingMessageId('streaming'); // Temporary ID until we get the real one
      });

      eventSource.addEventListener('token', (event) => {
        const data = JSON.parse(event.data);
        setIsThinking(false);
        setStreamingText(prev => prev + data.text);
      });

      eventSource.addEventListener('done', async (event) => {
        const data = JSON.parse(event.data);
        console.log('✅ SSE: Response complete');
        // Mark stream as successfully completed so onerror ignores the connection-close event
        streamCompletedRef.current = true;
        // Capture current stream ID to guard against race with new streams
        const streamIdAtStart = currentStreamId;
        // Call onComplete first and await it to avoid flash while waiting for refresh
        try {
          await onComplete(data.messageId, data.fullText);
        } finally {
          // Only reset state if this is still the current stream (no new stream started)
          if (streamIdRef.current === streamIdAtStart) {
            setIsThinking(false);
            setStreamingMessageId(null);
            setStreamingText('');
            setStreamingChannelId(null);
            eventSource.close();
            eventSourceRef.current = null;
          }
        }
      });

      eventSource.onerror = (err) => {
        // Ignore connection-close errors that fire after a successful 'done' event.
        // EventSource fires onerror when the server closes the connection, even on success.
        if (streamCompletedRef.current) {
          console.log('📡 SSE: Connection closed after successful completion (onerror suppressed)');
          return;
        }

        console.error('❌ SSE: Connection error', err);
        // Capture current stream ID to guard against race with new streams
        const streamIdAtError = currentStreamId;
        
        // Only reset state and invoke onError if this is still the current stream
        if (streamIdRef.current === streamIdAtError) {
          setIsThinking(false);
          setStreamingMessageId(null);
          setStreamingText('');
          setStreamingChannelId(null);
          eventSource.close();
          eventSourceRef.current = null;

          if (onError) {
            onError('Connection to server lost');
          }
        }
      };

    } catch (error) {
      console.error('Failed to start SSE stream:', error);
      setIsThinking(false);
      setStreamingMessageId(null);
      setStreamingText('');
      setStreamingChannelId(null);
      
      if (onError) {
        onError('Failed to initialize stream');
      }
    }
  }, [cancelStream]);

  return {
    streamingMessageId,
    streamingText,
    isThinking,
    streamingChannelId,
    startStream,
    cancelStream
  };
}
