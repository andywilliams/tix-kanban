import React, { useState, useEffect } from 'react';

interface WorkerState {
  enabled: boolean;
  interval: string;
  lastRun?: string;
  lastTaskId?: string;
  isRunning: boolean;
  workload: number;
}

interface WorkerStatusProps {
  className?: string;
}

export function WorkerStatus({ className }: WorkerStatusProps) {
  const [status, setStatus] = useState<WorkerState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/worker/status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setStatus(data.status);
    } catch (error) {
      console.error('Failed to fetch worker status:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleWorker = async () => {
    if (!status) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/worker/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setStatus(data.status);
    } catch (error) {
      console.error('Failed to toggle worker:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    // Poll for status updates every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !status) {
    return (
      <div className={`worker-status ${className || ''}`}>
        <div className="worker-status-loading">
          <span>⏳</span> Loading worker status...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`worker-status ${className || ''}`}>
        <div className="worker-status-error">
          <span>❌</span> Error: {error}
          <button onClick={fetchStatus} disabled={loading}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const formatLastRun = (lastRun?: string) => {
    if (!lastRun) return 'Never';
    
    const date = new Date(lastRun);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <div className={`worker-status ${className || ''}`}>
      <div className="worker-status-header">
        <div className="worker-status-indicator">
          <span className={`status-dot ${status.enabled ? 'enabled' : 'disabled'}`}>
            {status.isRunning ? '🔄' : status.enabled ? '🤖' : '💤'}
          </span>
          <span className="status-text">
            AI Worker {status.enabled ? (status.isRunning ? 'Running' : 'Enabled') : 'Disabled'}
          </span>
        </div>
        
        <button
          className={`worker-toggle ${status.enabled ? 'enabled' : 'disabled'}`}
          onClick={toggleWorker}
          disabled={loading}
          title={status.enabled ? 'Disable worker' : 'Enable worker'}
        >
          {status.enabled ? '🛑 Stop' : '▶️ Start'}
        </button>
      </div>
      
      {status.enabled && (
        <div className="worker-status-details">
          <div className="worker-stat">
            <span className="stat-label">Interval:</span>
            <span className="stat-value">{status.interval}</span>
          </div>
          
          <div className="worker-stat">
            <span className="stat-label">Last Run:</span>
            <span className="stat-value">{formatLastRun(status.lastRun)}</span>
          </div>
          
          <div className="worker-stat">
            <span className="stat-label">Workload:</span>
            <span className="stat-value">{status.workload} active tasks</span>
          </div>
          
          {status.lastTaskId && (
            <div className="worker-stat">
              <span className="stat-label">Last Task:</span>
              <span className="stat-value">{status.lastTaskId}</span>
            </div>
          )}
        </div>
      )}
      
    </div>
  );
}