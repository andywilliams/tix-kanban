import React, { useState, useEffect, useCallback } from 'react';

interface LogEntry {
  timestamp: string;
  date: string;
  entry: string;
  author: string;
}

export function ActivityLogPage() {
  const [entries, setEntries] = useState<Record<string, LogEntry[]>>({});
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/activity-log?days=14');
      const data = await res.json();
      setEntries(data.entries || {});
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/activity-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.trim() })
      });
      if (res.ok) {
        setNewMessage('');
        await fetchEntries();
      }
    } catch (err) {
      console.error('Failed to add log entry:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (date: string, index: number) => {
    try {
      const res = await fetch(`/api/activity-log/${date}/${index}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchEntries();
      }
    } catch (err) {
      console.error('Failed to delete log entry:', err);
    }
  };

  const sortedDates = Object.keys(entries).sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>📝 Activity Log</h2>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        Log work entries that appear in your standups. Same data as <code>tix log</code>.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          type="text"
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder="What did you work on?"
          style={{
            flex: 1,
            padding: '0.6rem 0.8rem',
            borderRadius: 6,
            border: '1px solid var(--color-border, #333)',
            background: 'var(--color-bg-secondary, #1a1a2e)',
            color: 'inherit',
            fontSize: '0.95rem'
          }}
        />
        <button
          type="submit"
          disabled={submitting || !newMessage.trim()}
          style={{
            padding: '0.6rem 1.2rem',
            borderRadius: 6,
            border: 'none',
            background: 'var(--color-primary, #3b82f6)',
            color: 'white',
            cursor: 'pointer',
            opacity: submitting || !newMessage.trim() ? 0.5 : 1
          }}
        >
          {submitting ? '...' : 'Log'}
        </button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : sortedDates.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No log entries yet. Start logging your work above!</p>
      ) : (
        sortedDates.map(date => (
          <div key={date} style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ 
              fontSize: '1rem', 
              borderBottom: '1px solid var(--color-border, #333)', 
              paddingBottom: '0.3rem',
              marginBottom: '0.5rem'
            }}>
              {date}
            </h3>
            {entries[date].map((entry, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 4,
                  marginBottom: '0.3rem',
                  background: 'var(--color-bg-secondary, #1a1a2e)'
                }}
              >
                <div>
                  <span style={{ marginRight: '0.6rem' }}>{entry.entry}</span>
                  <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()} · {entry.author}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(date, idx)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-danger, #ef4444)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    padding: '0.2rem 0.4rem'
                  }}
                  title="Delete entry"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
