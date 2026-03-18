import { useState, useCallback, useRef } from 'react';

/**
 * Hook for SSE streaming chat responses
 * Provides token-by-token streaming with graceful fallback to polling
 */
export function useChatStreaming() {
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cancelStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStreamingMessageId(null);
    setStreamingText('');
    setIsThinking(false);
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

      eventSource.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        console.log('✅ SSE: Response complete');
        setIsThinking(false);
        setStreamingMessageId(null);
        setStreamingText('');
        eventSource.close();
        eventSourceRef.current = null;
        onComplete(data.messageId, data.fullText);
      });

      eventSource.addEventListener('error', (event: any) => {
        let errorMessage = 'Stream error';
        try {
          const data = JSON.parse(event.data);
          errorMessage = data.error || errorMessage;
        } catch {
          // Error parsing error event
        }
        
        console.error('❌ SSE: Error -', errorMessage);
        setIsThinking(false);
        setStreamingMessageId(null);
        setStreamingText('');
        eventSource.close();
        eventSourceRef.current = null;
        
        if (onError) {
          onError(errorMessage);
        }
      });

      eventSource.onerror = (err) => {
        console.error('❌ SSE: Connection error', err);
        setIsThinking(false);
        setStreamingMessageId(null);
        setStreamingText('');
        eventSource.close();
        eventSourceRef.current = null;
        
        if (onError) {
          onError('Connection to server lost');
        }
      };

    } catch (error) {
      console.error('Failed to start SSE stream:', error);
      setIsThinking(false);
      setStreamingMessageId(null);
      setStreamingText('');
      
      if (onError) {
        onError('Failed to initialize stream');
      }
    }
  }, [cancelStream]);

  return {
    streamingMessageId,
    streamingText,
    isThinking,
    startStream,
    cancelStream
  };
}
