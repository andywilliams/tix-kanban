import React, { useState, useEffect } from 'react';
import { AgentMemory, MemoryEntry } from '../types';
import { useAgentMemory } from '../hooks/useAgentMemory';

interface MemoryViewerProps {
  personaId: string;
  personaName: string;
  personaEmoji: string;
  userId?: string;
  onClose: () => void;
}

const CATEGORY_ICONS: Record<MemoryEntry['category'], string> = {
  preferences: '⭐',
  context: '📚',
  instructions: '📋',
  relationships: '🤝'
};

const CATEGORY_COLORS: Record<MemoryEntry['category'], string> = {
  preferences: 'rgba(234, 179, 8, 0.2)',
  context: 'rgba(59, 130, 246, 0.2)',
  instructions: 'rgba(34, 197, 94, 0.2)',
  relationships: 'rgba(168, 85, 247, 0.2)'
};

export function MemoryViewer({ personaId, personaName, personaEmoji, userId = 'default', onClose }: MemoryViewerProps) {
  const { memory, loading, error, fetchMemory, addEntry, updateEntry, deleteEntry, clearAllMemories } = useAgentMemory(personaId, userId);
  const [activeCategory, setActiveCategory] = useState<MemoryEntry['category'] | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState({
    category: 'context' as MemoryEntry['category'],
    content: '',
    keywords: '',
    importance: 5
  });
  const [editingEntry, setEditingEntry] = useState<string | null>(null);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

  const filteredEntries = (memory?.entries || [])
    .filter(e => activeCategory === 'all' || e.category === activeCategory)
    .filter(e => 
      !searchQuery || 
      e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => b.importance - a.importance);

  const handleAddEntry = async () => {
    if (!newEntry.content.trim()) return;
    
    try {
      await addEntry({
        category: newEntry.category,
        content: newEntry.content,
        keywords: newEntry.keywords.split(',').map(k => k.trim()).filter(Boolean),
        importance: newEntry.importance
      });
      setNewEntry({ category: 'context', content: '', keywords: '', importance: 5 });
      setShowAddForm(false);
    } catch (err) {
      console.error('Failed to add entry:', err);
    }
  };

  const handleUpdateImportance = async (entryId: string, importance: number) => {
    try {
      await updateEntry(entryId, { importance });
    } catch (err) {
      console.error('Failed to update entry:', err);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Delete this memory?')) return;
    
    try {
      await deleteEntry(entryId);
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm(`Clear all memories for ${personaName}? This cannot be undone.`)) return;
    
    try {
      await clearAllMemories();
    } catch (err) {
      console.error('Failed to clear memories:', err);
    }
  };

  const categoryCounts = (memory?.entries || []).reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: '0.75rem',
        width: '90%', maxWidth: '700px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid var(--border)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{personaEmoji}</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                {personaName}'s Memory
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {memory?.entries.length || 0} memories • {memory?.interactionCount || 0} interactions
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => setShowAddForm(true)}
              style={{ padding: '0.5rem 0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              + Add Memory
            </button>
            <button onClick={onClose}
              style={{ padding: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>
              ×
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          <button onClick={() => setActiveCategory('all')}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: '9999px', border: 'none', cursor: 'pointer',
              background: activeCategory === 'all' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: activeCategory === 'all' ? '#fff' : 'var(--text-secondary)',
              fontSize: '0.8rem', whiteSpace: 'nowrap'
            }}>
            All ({memory?.entries.length || 0})
          </button>
          {(['preferences', 'context', 'instructions', 'relationships'] as const).map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              style={{
                padding: '0.4rem 0.75rem', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                background: activeCategory === cat ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: activeCategory === cat ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.8rem', whiteSpace: 'nowrap', textTransform: 'capitalize'
              }}>
              {CATEGORY_ICONS[cat]} {cat} ({categoryCounts[cat] || 0})
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            style={{
              width: '100%', padding: '0.5rem 0.75rem',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: '0.375rem', color: 'var(--text-primary)', fontSize: '0.85rem'
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div className="spinner" />
              <p style={{ color: 'var(--text-muted)' }}>Loading memories...</p>
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-danger)' }}>
              {error}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              {memory?.entries.length === 0 ? (
                <>
                  <p>No memories yet</p>
                  <p style={{ fontSize: '0.85rem' }}>
                    Use "@{personaName}, remember that..." in chat to add memories
                  </p>
                </>
              ) : (
                <p>No memories match your filter</p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filteredEntries.map(entry => (
                <div key={entry.id}
                  style={{
                    padding: '1rem',
                    background: CATEGORY_COLORS[entry.category],
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)'
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{CATEGORY_ICONS[entry.category]}</span>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        padding: '0.15rem 0.4rem', 
                        background: 'var(--bg-tertiary)', 
                        borderRadius: '0.25rem',
                        textTransform: 'capitalize'
                      }}>
                        {entry.category}
                      </span>
                      <span style={{ 
                        fontSize: '0.65rem', 
                        color: 'var(--text-muted)'
                      }}>
                        {entry.source === 'explicit' ? '(user added)' : entry.source === 'inferred' ? '(inferred)' : '(from feedback)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Importance:</span>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={entry.importance}
                          onChange={(e) => handleUpdateImportance(entry.id, parseInt(e.target.value))}
                          style={{ width: '60px' }}
                        />
                        <span style={{ fontSize: '0.75rem', width: '1rem' }}>{entry.importance}</span>
                      </div>
                      <button onClick={() => handleDeleteEntry(entry.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        🗑️
                      </button>
                    </div>
                  </div>
                  
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    {entry.content}
                  </p>
                  
                  {entry.keywords.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {entry.keywords.map((kw, i) => (
                        <span key={i} style={{
                          padding: '0.1rem 0.3rem',
                          background: 'var(--bg-primary)',
                          borderRadius: '0.2rem',
                          fontSize: '0.7rem',
                          color: 'var(--text-muted)'
                        }}>
                          #{kw}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div style={{ 
                    marginTop: '0.5rem', 
                    fontSize: '0.65rem', 
                    color: 'var(--text-muted)' 
                  }}>
                    Created: {new Date(entry.createdAt).toLocaleDateString()}
                    {entry.updatedAt !== entry.createdAt && ` • Updated: ${new Date(entry.updatedAt).toLocaleDateString()}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ 
          padding: '0.75rem 1rem', 
          borderTop: '1px solid var(--border)', 
          background: 'var(--bg-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <button onClick={handleClearAll}
            style={{ 
              padding: '0.4rem 0.75rem', 
              background: 'var(--bg-tertiary)', 
              color: 'var(--color-danger)', 
              border: 'none', 
              borderRadius: '0.375rem', 
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}>
            Clear All Memories
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Memories help {personaName} remember your preferences and context
          </span>
        </div>
      </div>

      {/* Add Memory Form Modal */}
      {showAddForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110
        }}>
          <div style={{
            background: 'var(--bg-primary)', borderRadius: '0.75rem',
            padding: '1.5rem', width: '90%', maxWidth: '500px',
            border: '1px solid var(--border)'
          }}>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--text-primary)' }}>
              Add Memory for {personaName}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Category
                </label>
                <select
                  value={newEntry.category}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, category: e.target.value as MemoryEntry['category'] }))}
                  style={{
                    width: '100%', padding: '0.5rem',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                    borderRadius: '0.375rem', color: 'var(--text-primary)'
                  }}>
                  <option value="preferences">⭐ Preferences</option>
                  <option value="context">📚 Context</option>
                  <option value="instructions">📋 Instructions</option>
                  <option value="relationships">🤝 Relationships</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Content
                </label>
                <textarea
                  value={newEntry.content}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="What should they remember?"
                  rows={3}
                  style={{
                    width: '100%', padding: '0.5rem',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                    borderRadius: '0.375rem', color: 'var(--text-primary)', resize: 'vertical'
                  }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  value={newEntry.keywords}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, keywords: e.target.value }))}
                  placeholder="e.g., typescript, react, testing"
                  style={{
                    width: '100%', padding: '0.5rem',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                    borderRadius: '0.375rem', color: 'var(--text-primary)'
                  }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Importance: {newEntry.importance}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={newEntry.importance}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, importance: parseInt(e.target.value) }))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={() => setShowAddForm(false)}
                style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleAddEntry}
                style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
                Add Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
