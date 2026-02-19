import React, { useState, useEffect, useCallback } from 'react';

interface NoteEntry {
  id: string;
  timestamp: string;
  date: string;
  content: string;
  author: string;
}

export function DailyNotesPage() {
  const [notes, setNotes] = useState<Record<string, NoteEntry[]>>({});
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-notes?days=14');
      const data = await res.json();
      setNotes(data.notes || {});
    } catch (err) {
      console.error('Failed to fetch daily notes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/daily-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNote.trim() })
      });
      if (res.ok) {
        setNewNote('');
        await fetchNotes();
      }
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (date: string, id: string) => {
    try {
      const res = await fetch(`/api/daily-notes/${date}/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchNotes();
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleEditStart = (note: NoteEntry) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleEditSave = async (date: string, id: string) => {
    if (!editContent.trim()) return;
    try {
      const res = await fetch(`/api/daily-notes/${date}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() })
      });
      if (res.ok) {
        setEditingId(null);
        setEditContent('');
        await fetchNotes();
      }
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditContent('');
  };

  const sortedDates = Object.keys(notes).sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>🗒️ Daily Notes</h2>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        Jot down thoughts, reminders, and notes throughout the day.
      </p>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Write a note..."
          rows={3}
          style={{
            width: '100%',
            padding: '0.6rem 0.8rem',
            borderRadius: 6,
            border: '1px solid var(--color-border, #333)',
            background: 'var(--color-bg-secondary, #1a1a2e)',
            color: 'inherit',
            fontSize: '0.95rem',
            resize: 'vertical',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            marginBottom: '0.5rem'
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>Cmd+Enter to submit</span>
          <button
            type="submit"
            disabled={submitting || !newNote.trim()}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #3b82f6)',
              color: 'white',
              cursor: 'pointer',
              opacity: submitting || !newNote.trim() ? 0.5 : 1
            }}
          >
            {submitting ? '...' : 'Add Note'}
          </button>
        </div>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : sortedDates.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No notes yet. Start writing above!</p>
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
            {notes[date].map(note => (
              <div
                key={note.id}
                style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: 4,
                  marginBottom: '0.5rem',
                  background: 'var(--color-bg-secondary, #1a1a2e)'
                }}
              >
                {editingId === note.id ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        borderRadius: 4,
                        border: '1px solid var(--color-border, #333)',
                        background: 'var(--color-bg-primary, #0f0f1a)',
                        color: 'inherit',
                        fontSize: '0.95rem',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                        marginBottom: '0.4rem'
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          handleEditSave(date, note.id);
                        }
                        if (e.key === 'Escape') {
                          handleEditCancel();
                        }
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      <button
                        onClick={handleEditCancel}
                        style={{
                          padding: '0.3rem 0.8rem',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #333)',
                          background: 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: '0.85rem'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditSave(date, note.id)}
                        style={{
                          padding: '0.3rem 0.8rem',
                          borderRadius: 4,
                          border: 'none',
                          background: 'var(--color-primary, #3b82f6)',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '0.85rem'
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ whiteSpace: 'pre-wrap', marginBottom: '0.3rem' }}>
                      {note.content}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>
                        {new Date(note.timestamp).toLocaleTimeString()} · {note.author}
                      </span>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          onClick={() => handleEditStart(note)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-primary, #3b82f6)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.4rem'
                          }}
                          title="Edit note"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(date, note.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-danger, #ef4444)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            padding: '0.2rem 0.4rem'
                          }}
                          title="Delete note"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
