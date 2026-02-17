import React, { useState, useEffect } from 'react';

interface CommitInfo {
  repo: string;
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface PRActivity {
  repo: string;
  number: number;
  title: string;
  action: 'opened' | 'merged' | 'reviewed' | 'closed';
  url: string;
  date: string;
}

interface IssueActivity {
  repo: string;
  number: number;
  title: string;
  action: 'closed' | 'opened';
  url: string;
  date: string;
}

interface StandupEntry {
  id: string;
  date: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  commits: CommitInfo[];
  prs: PRActivity[];
  issues: IssueActivity[];
  generatedAt: string;
}

export function StandupPage() {
  const [standups, setStandups] = useState<StandupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [currentStandup, setCurrentStandup] = useState<StandupEntry | null>(null);

  // Load standup history
  const loadStandups = async (daysToLoad: number = days) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/standup/history?days=${daysToLoad}`);
      if (!response.ok) {
        throw new Error(`Failed to load standups: ${response.statusText}`);
      }
      const data = await response.json();
      setStandups(data.standups || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Generate new standup
  const generateStandup = async (hours: number = 24) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/standup/generate?hours=${hours}`);
      if (!response.ok) {
        throw new Error(`Failed to generate standup: ${response.statusText}`);
      }
      const data = await response.json();
      setCurrentStandup(data.standup);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Save current standup
  const saveStandup = async () => {
    if (!currentStandup) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/standup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentStandup),
      });
      if (!response.ok) {
        throw new Error(`Failed to save standup: ${response.statusText}`);
      }
      await loadStandups(); // Refresh the list
      setCurrentStandup(null); // Clear current
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Delete standup
  const deleteStandup = async (id: string) => {
    if (!confirm('Are you sure you want to delete this standup?')) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/standup/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete standup: ${response.statusText}`);
      }
      await loadStandups(); // Refresh the list
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load data on mount
  useEffect(() => {
    loadStandups();
  }, []);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (isoString: string): string => {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStandupEntry = (entry: StandupEntry, isGenerated: boolean = false) => (
    <div key={entry.id} className="standup-entry">
      <div className="standup-header">
        <h3>📋 {formatDate(entry.date)}</h3>
        <div className="standup-meta">
          <span className="generated-time">
            {isGenerated ? 'Generated now' : `Generated ${formatTime(entry.generatedAt)}`}
          </span>
          {!isGenerated && (
            <button
              className="delete-btn"
              onClick={() => deleteStandup(entry.id)}
              disabled={loading}
            >
              🗑️ Delete
            </button>
          )}
        </div>
      </div>
      
      <div className="standup-content">
        <div className="standup-section">
          <h4 className="section-title yesterday">✅ Yesterday</h4>
          <ul className="standup-list">
            {entry.yesterday.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="standup-section">
          <h4 className="section-title today">🎯 Today</h4>
          <ul className="standup-list">
            {entry.today.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="standup-section">
          <h4 className="section-title blockers">🚫 Blockers</h4>
          <ul className="standup-list">
            {entry.blockers.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>

        {(entry.commits.length > 0 || entry.prs.length > 0 || entry.issues.length > 0) && (
          <details className="raw-data">
            <summary>📊 Raw Activity Data</summary>
            <div className="activity-stats">
              {entry.commits.length > 0 && <span>Commits: {entry.commits.length}</span>}
              {entry.prs.length > 0 && <span>PR activity: {entry.prs.length}</span>}
              {entry.issues.length > 0 && <span>Issues closed: {entry.issues.length}</span>}
            </div>
          </details>
        )}
      </div>

      {isGenerated && (
        <div className="standup-actions">
          <button
            className="save-btn primary"
            onClick={saveStandup}
            disabled={loading}
          >
            💾 Save Standup
          </button>
          <button
            className="cancel-btn"
            onClick={() => setCurrentStandup(null)}
          >
            ❌ Cancel
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="standup-page">
      <div className="page-header">
        <h2>📋 Daily Standups</h2>
        <p className="page-description">
          Auto-generated standups from git commits and GitHub activity
        </p>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="controls">
        <div className="generate-controls">
          <button
            className="generate-btn primary"
            onClick={() => generateStandup(24)}
            disabled={generating || loading}
          >
            {generating ? '⏳ Generating...' : '✨ Generate Today\'s Standup'}
          </button>
          <button
            className="generate-btn"
            onClick={() => generateStandup(48)}
            disabled={generating || loading}
          >
            Generate (48h lookback)
          </button>
        </div>

        <div className="filter-controls">
          <label>
            Show last:
            <select 
              value={days} 
              onChange={(e) => {
                const newDays = parseInt(e.target.value);
                setDays(newDays);
                loadStandups(newDays);
              }}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            className="refresh-btn"
            onClick={() => loadStandups()}
            disabled={loading}
          >
            {loading ? '⏳' : '🔄'} Refresh
          </button>
        </div>
      </div>

      <div className="standup-list">
        {currentStandup && renderStandupEntry(currentStandup, true)}

        {loading && !generating && (
          <div className="loading">
            <p>⏳ Loading standups...</p>
          </div>
        )}

        {!loading && standups.length === 0 && !currentStandup && (
          <div className="empty-state">
            <p>📝 No standups found for the last {days} days.</p>
            <p>Generate your first standup to get started!</p>
          </div>
        )}

        {standups.map((entry) => renderStandupEntry(entry))}
      </div>
    </div>
  );
}