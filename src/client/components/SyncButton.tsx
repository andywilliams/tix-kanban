import React, { useState, useRef } from 'react';

interface SyncProgress {
  step: string;
  status: 'started' | 'progress' | 'completed' | 'error';
  message: string;
  data?: any;
  timestamp: string;
}

interface SyncButtonProps {
  onSyncComplete?: () => void;
}

export function SyncButton({ onSyncComplete }: SyncButtonProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startSync = async () => {
    if (isRunning) return;

    setIsRunning(true);
    setProgress([]);
    setShowProgress(true);

    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Start Server-Sent Events connection
      const eventSource = new EventSource('/api/sync/full');
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data: SyncProgress = JSON.parse(event.data);
          setProgress(prev => [...prev, data]);

          // Auto-close progress on completion
          if (data.step === 'complete' || data.step === 'error') {
            setTimeout(() => {
              setIsRunning(false);
              if (data.step === 'complete' && onSyncComplete) {
                onSyncComplete();
              }
              // Auto-hide after 3 seconds
              setTimeout(() => setShowProgress(false), 3000);
            }, 1000);
          }
        } catch (parseError) {
          console.error('Failed to parse sync progress:', parseError);
        }
      };

      eventSource.onerror = (error) => {
        console.error('Sync EventSource error:', error);
        setIsRunning(false);
        setProgress(prev => [...prev, {
          step: 'error',
          status: 'error',
          message: 'Connection to sync service lost',
          timestamp: new Date().toISOString()
        }]);
        eventSource.close();
      };

      // Cleanup function
      return () => {
        eventSource.close();
      };

    } catch (error) {
      console.error('Failed to start sync:', error);
      setIsRunning(false);
      setProgress([{
        step: 'error',
        status: 'error',
        message: `Failed to start sync: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const closeProgress = () => {
    setShowProgress(false);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (isRunning) {
      setIsRunning(false);
    }
  };

  // Get the current step status for display
  const getCurrentStepStatus = () => {
    if (progress.length === 0) return null;
    const lastStep = progress[progress.length - 1];
    
    if (lastStep.step === 'complete') return { icon: '✅', text: 'Complete' };
    if (lastStep.step === 'error') return { icon: '❌', text: 'Error' };
    if (lastStep.status === 'started') return { icon: '🔄', text: 'Syncing...' };
    return { icon: '⏳', text: 'Working...' };
  };

  const currentStatus = getCurrentStepStatus();

  return (
    <>
      <button
        className="sync-button"
        onClick={startSync}
        disabled={isRunning}
        aria-label="Full sync"
        style={{
          backgroundColor: isRunning ? 'var(--color-warning, #f59e0b)' : 'var(--color-success, #10b981)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '8px 16px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          opacity: isRunning ? 0.8 : 1,
          transition: 'all 0.2s ease'
        }}
      >
        {isRunning ? '🔄' : '🔄'} Sync
        {currentStatus && isRunning && (
          <span style={{ fontSize: '12px', opacity: 0.9 }}>
            {currentStatus.text}
          </span>
        )}
      </button>

      {/* Progress Modal */}
      {showProgress && (
        <div 
          className="sync-progress-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={closeProgress}
        >
          <div
            className="sync-progress-modal"
            style={{
              backgroundColor: '#1e1e2e',
              color: '#e0e0e0',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '400px',
              overflowY: 'auto',
              border: '1px solid #333',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#fff' }}>
                Full Sync Progress
              </h3>
              <button
                onClick={closeProgress}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  color: '#9ca3af'
                }}
              >
                ✕
              </button>
            </div>
            
            <div className="sync-progress-list" style={{ fontSize: '14px', lineHeight: '1.5' }}>
              {progress.map((step, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 0',
                    borderBottom: index < progress.length - 1 ? '1px solid #333' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>
                    {step.status === 'started' ? '🔄' : 
                     step.status === 'completed' ? '✅' : 
                     step.status === 'error' ? '❌' : '⏳'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      fontWeight: step.status === 'error' ? '600' : '500',
                      color: step.status === 'error' ? '#ef4444' : '#e0e0e0'
                    }}>
                      {step.message}
                    </div>
                    {step.data && (
                      <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '2px' }}>
                        {JSON.stringify(step.data)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {isRunning && progress.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af' }}>
                  🔄 Starting sync pipeline...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}