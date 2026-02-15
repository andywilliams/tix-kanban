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
      
      <style jsx>{`
        .worker-status {
          background: var(--bg-secondary, #1e293b);
          border: 1px solid var(--border, #334155);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        
        .worker-status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        
        .worker-status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .status-dot {
          font-size: 16px;
        }
        
        .status-text {
          font-weight: 500;
        }
        
        .worker-toggle {
          padding: 6px 12px;
          border: 1px solid var(--border, #334155);
          border-radius: 4px;
          background: var(--bg-primary, #0f172a);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }
        
        .worker-toggle:hover {
          background: var(--bg-hover, #1e293b);
        }
        
        .worker-toggle:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .worker-toggle.disabled {
          background: #22c55e;
          color: white;
          border-color: #22c55e;
        }
        
        .worker-toggle.disabled:hover {
          background: #16a34a;
        }
        
        .worker-toggle.enabled {
          background: #dc3545;
          color: white;
          border-color: #dc3545;
        }
        
        .worker-toggle.enabled:hover {
          background: #c82333;
        }
        
        .worker-status-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          border-top: 1px solid var(--border, #334155);
          padding-top: 12px;
        }
        
        .worker-stat {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .stat-label {
          color: var(--text-muted, #94a3b8);
          font-weight: 500;
        }
        
        .stat-value {
          font-family: monospace;
          font-size: 12px;
          color: var(--text-secondary, #cbd5e1);
        }
        
        .worker-status-loading,
        .worker-status-error {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-muted, #94a3b8);
        }
        
        .worker-status-error {
          color: #dc3545;
        }
        
        .worker-status-error button {
          margin-left: auto;
          padding: 4px 8px;
          font-size: 12px;
          border: 1px solid #dc3545;
          color: #dc3545;
          background: var(--bg-primary, #0f172a);
          border-radius: 4px;
          cursor: pointer;
          color: var(--text-primary, #e2e8f0);
        }
      `}</style>
    </div>
  );
}