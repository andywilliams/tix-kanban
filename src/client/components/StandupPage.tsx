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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ yesterday: string[]; today: string[]; blockers: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  // Start editing a standup
  const startEditing = (entry: StandupEntry) => {
    setEditingId(entry.id);
    setEditData({
      yesterday: [...entry.yesterday],
      today: [...entry.today],
      blockers: [...entry.blockers],
    });
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditData(null);
  };

  // Save edited standup
  const saveEdited = async () => {
    if (!editingId || !editData) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/standup/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      });
      if (!response.ok) throw new Error(`Failed to save: ${response.statusText}`);
      cancelEditing();
      await loadStandups();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Edit helpers
  const updateEditItem = (section: 'yesterday' | 'today' | 'blockers', index: number, value: string) => {
    if (!editData) return;
    const updated = [...editData[section]];
    updated[index] = value;
    setEditData({ ...editData, [section]: updated });
  };

  const deleteEditItem = (section: 'yesterday' | 'today' | 'blockers', index: number) => {
    if (!editData) return;
    const updated = editData[section].filter((_, i) => i !== index);
    setEditData({ ...editData, [section]: updated });
  };

  const addEditItem = (section: 'yesterday' | 'today' | 'blockers') => {
    if (!editData) return;
    setEditData({ ...editData, [section]: [...editData[section], ''] });
  };

  // Copy standup to clipboard as plain text
  const copyToClipboard = async (entry: StandupEntry) => {
    const lines: string[] = [];
    lines.push(`Standup - ${formatDate(entry.date)}`);
    lines.push('');
    lines.push('Yesterday:');
    entry.yesterday.forEach(item => lines.push(`- ${item}`));
    lines.push('');
    lines.push('Today:');
    entry.today.forEach(item => lines.push(`- ${item}`));
    lines.push('');
    lines.push('Blockers:');
    entry.blockers.forEach(item => lines.push(`- ${item}`));

    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
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

  const renderEditableSection = (section: 'yesterday' | 'today' | 'blockers', label: string, emoji: string) => {
    if (!editData) return null;
    const items = editData[section];
    return (
      <div className="standup-section">
        <h4 className="section-title {section}">{emoji} {label}</h4>
        <ul className="standup-list" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((item, idx) => (
            <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
              <input
                type="text"
                value={item}
                onChange={(e) => updateEditItem(section, idx, e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.3rem 0.5rem',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #333)',
                  background: 'var(--color-bg-secondary, #1a1a2e)',
                  color: 'inherit',
                  fontSize: '0.9rem'
                }}
              />
              <button
                onClick={() => deleteEditItem(section, idx)}
                style={{ background: 'none', border: 'none', color: 'var(--color-danger, #ef4444)', cursor: 'pointer', fontSize: '1rem' }}
                title="Remove"
              >✕</button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => addEditItem(section)}
          style={{
            background: 'none',
            border: '1px dashed var(--color-border, #555)',
            color: 'var(--color-text-secondary, #aaa)',
            cursor: 'pointer',
            padding: '0.2rem 0.6rem',
            borderRadius: 4,
            fontSize: '0.85rem'
          }}
        >+ Add item</button>
      </div>
    );
  };

  const renderStandupEntry = (entry: StandupEntry, isGenerated: boolean = false) => {
    const isEditing = editingId === entry.id;

    return (
      <div key={entry.id} className="standup-entry">
        <div className="standup-header">
          <h3>📋 {formatDate(entry.date)}</h3>
          <div className="standup-meta">
            <span className="generated-time">
              {isGenerated ? 'Generated now' : `Generated ${formatTime(entry.generatedAt)}`}
            </span>
            {!isGenerated && !isEditing && (
              <>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(entry)}
                  style={{ marginRight: '0.3rem' }}
                >
                  {copiedId === entry.id ? '✅ Copied!' : '📋 Copy'}
                </button>
                <button
                  className="edit-btn"
                  onClick={() => startEditing(entry)}
                  disabled={loading}
                  style={{ marginRight: '0.3rem' }}
                >
                  ✏️ Edit
                </button>
                <button
                  className="delete-btn"
                  onClick={() => deleteStandup(entry.id)}
                  disabled={loading}
                >
                  🗑️ Delete
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button
                  className="save-btn primary"
                  onClick={saveEdited}
                  disabled={saving}
                  style={{ marginRight: '0.3rem' }}
                >
                  {saving ? '⏳' : '💾'} Save
                </button>
                <button
                  className="cancel-btn"
                  onClick={cancelEditing}
                >
                  ❌ Cancel
                </button>
              </>
            )}
          </div>
        </div>
        
        <div className="standup-content">
          {isEditing ? (
            <>
              {renderEditableSection('yesterday', 'Yesterday', '✅')}
              {renderEditableSection('today', 'Today', '🎯')}
              {renderEditableSection('blockers', 'Blockers', '🚫')}
            </>
          ) : (
            <>
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
            </>
          )}

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
              className="copy-btn"
              onClick={() => copyToClipboard(entry)}
            >
              {copiedId === entry.id ? '✅ Copied!' : '📋 Copy'}
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
  };

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