import React, { useState, useEffect } from 'react';
import { MemoryEntry, StructuredMemory, PersonaSoul, Persona } from '../types';

interface PersonaMemoryPanelProps {
  persona: Persona;
  onClose?: () => void;
}

const CATEGORY_LABELS: Record<MemoryEntry['category'], { label: string; emoji: string; color: string }> = {
  preference: { label: 'Preference', emoji: '💜', color: '#a855f7' },
  instruction: { label: 'Instruction', emoji: '📋', color: '#3b82f6' },
  context: { label: 'Context', emoji: '💭', color: '#6b7280' },
  relationship: { label: 'Relationship', emoji: '🤝', color: '#10b981' },
  learning: { label: 'Learning', emoji: '📚', color: '#f59e0b' },
  reflection: { label: 'Reflection', emoji: '🔮', color: '#ec4899' },
};

const IMPORTANCE_COLORS: Record<MemoryEntry['importance'], string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

export function PersonaMemoryPanel({ persona, onClose }: PersonaMemoryPanelProps) {
  const [activeTab, setActiveTab] = useState<'memories' | 'soul' | 'add'>('memories');
  const [memory, setMemory] = useState<StructuredMemory | null>(null);
  const [soul, setSoul] = useState<PersonaSoul | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<MemoryEntry['category'] | 'all'>('all');
  
  // New memory form
  const [newMemory, setNewMemory] = useState({
    category: 'instruction' as MemoryEntry['category'],
    content: '',
    importance: 'medium' as MemoryEntry['importance'],
  });
  
  // Soul editing
  const [editingSoul, setEditingSoul] = useState(false);
  const [soulDraft, setSoulDraft] = useState<PersonaSoul | null>(null);

  useEffect(() => {
    loadData();
  }, [persona.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [memRes, soulRes] = await Promise.all([
        fetch(`/api/personas/${persona.id}/memories`),
        fetch(`/api/personas/${persona.id}/soul`),
      ]);
      
      if (memRes.ok) {
        const memData = await memRes.json();
        setMemory(memData);
      }
      
      if (soulRes.ok) {
        const soulData = await soulRes.json();
        setSoul(soulData);
        setSoulDraft(soulData);
      }
    } catch (error) {
      console.error('Failed to load persona data:', error);
    }
    setLoading(false);
  };

  const addMemoryEntry = async () => {
    if (!newMemory.content.trim()) return;
    
    try {
      const res = await fetch(`/api/personas/${persona.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newMemory,
          source: 'user',
        }),
      });
      
      if (res.ok) {
        setNewMemory({ category: 'instruction', content: '', importance: 'medium' });
        loadData();
        setActiveTab('memories');
      }
    } catch (error) {
      console.error('Failed to add memory:', error);
    }
  };

  const deleteMemoryEntry = async (entryId: string) => {
    try {
      const res = await fetch(`/api/personas/${persona.id}/memories/${entryId}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        loadData();
      }
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  const saveSoul = async () => {
    if (!soulDraft) return;
    
    try {
      const res = await fetch(`/api/personas/${persona.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(soulDraft),
      });
      
      if (res.ok) {
        setSoul(soulDraft);
        setEditingSoul(false);
      }
    } catch (error) {
      console.error('Failed to save soul:', error);
    }
  };

  const filteredEntries = memory?.entries.filter(entry => {
    if (filterCategory !== 'all' && entry.category !== filterCategory) return false;
    if (searchQuery && !entry.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }) || [];

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    const impOrder = { high: 0, medium: 1, low: 2 };
    const impDiff = impOrder[a.importance] - impOrder[b.importance];
    if (impDiff !== 0) return impDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading {persona.emoji} {persona.name}'s mind...
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '0.75rem',
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem 1.5rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-tertiary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>{persona.emoji}</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>{persona.name}'s Mind</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {memory?.entries.length || 0} memories • {soul?.archetype || 'No soul defined'}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            padding: '0.5rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '1.2rem',
          }}>✕</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}>
        {(['memories', 'soul', 'add'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              background: activeTab === tab ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
          >
            {tab === 'memories' && '🧠 Memories'}
            {tab === 'soul' && '✨ Personality'}
            {tab === 'add' && '➕ Add Memory'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '1rem', maxHeight: '60vh', overflowY: 'auto' }}>
        
        {/* Memories Tab */}
        {activeTab === 'memories' && (
          <div>
            {/* Search & Filter */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search memories..."
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                }}
              />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as any)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                }}
              >
                <option value="all">All Categories</option>
                {Object.entries(CATEGORY_LABELS).map(([key, { label, emoji }]) => (
                  <option key={key} value={key}>{emoji} {label}</option>
                ))}
              </select>
            </div>

            {/* Memory List */}
            {sortedEntries.length === 0 ? (
              <div style={{
                padding: '2rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                background: 'var(--bg-primary)',
                borderRadius: '0.5rem',
              }}>
                <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🧠</p>
                <p>No memories yet.</p>
                <p style={{ fontSize: '0.85rem' }}>
                  Try saying "@{persona.name}, remember that..." in chat!
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sortedEntries.map(entry => {
                  const cat = CATEGORY_LABELS[entry.category];
                  return (
                    <div
                      key={entry.id}
                      style={{
                        padding: '0.75rem 1rem',
                        background: 'var(--bg-primary)',
                        borderRadius: '0.5rem',
                        borderLeft: `3px solid ${cat.color}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <span style={{ fontSize: '0.9rem' }}>{cat.emoji}</span>
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '0.25rem',
                              background: `${cat.color}20`,
                              color: cat.color,
                              fontWeight: 500,
                            }}>{cat.label}</span>
                            {entry.importance === 'high' && (
                              <span style={{
                                fontSize: '0.7rem',
                                padding: '0.15rem 0.4rem',
                                borderRadius: '0.25rem',
                                background: '#ef444420',
                                color: '#ef4444',
                                fontWeight: 500,
                              }}>⚠️ Important</span>
                            )}
                          </div>
                          <p style={{
                            margin: 0,
                            fontSize: '0.9rem',
                            color: 'var(--text-primary)',
                            lineHeight: 1.4,
                          }}>{entry.content}</p>
                          <p style={{
                            margin: '0.25rem 0 0',
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                          }}>
                            From {entry.source} • {new Date(entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteMemoryEntry(entry.id)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            opacity: 0.5,
                          }}
                          title="Delete memory"
                        >🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Soul/Personality Tab */}
        {activeTab === 'soul' && soul && (
          <div>
            {!editingSoul ? (
              <div>
                <div style={{
                  padding: '1.5rem',
                  background: 'var(--bg-primary)',
                  borderRadius: '0.75rem',
                  marginBottom: '1rem',
                  textAlign: 'center',
                }}>
                  <span style={{ fontSize: '2.5rem' }}>{soul.emoji}</span>
                  <h3 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.3rem' }}>{soul.name}</h3>
                  <p style={{
                    margin: 0,
                    color: 'var(--accent)',
                    fontStyle: 'italic',
                    fontSize: '1rem',
                  }}>"{soul.archetype}"</p>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      🎭 Personality Traits
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span className="trait-badge" style={{ background: '#3b82f620', color: '#3b82f6' }}>
                        {soul.traits.communication}
                      </span>
                      <span className="trait-badge" style={{ background: '#10b98120', color: '#10b981' }}>
                        {soul.traits.approach}
                      </span>
                      <span className="trait-badge" style={{ background: '#f59e0b20', color: '#f59e0b' }}>
                        {soul.traits.style}
                      </span>
                    </div>
                  </div>

                  {soul.voicePatterns.length > 0 && (
                    <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        🗣️ Voice Patterns
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {soul.voicePatterns.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}

                  {soul.catchphrases.length > 0 && (
                    <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        💬 Catchphrases
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {soul.catchphrases.map((c, i) => (
                          <p key={i} style={{
                            margin: 0,
                            fontSize: '0.9rem',
                            color: 'var(--text-secondary)',
                            fontStyle: 'italic',
                          }}>"{c}"</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {soul.values.length > 0 && (
                    <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        💎 Values
                      </h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {soul.values.map((v, i) => (
                          <span key={i} style={{
                            padding: '0.25rem 0.5rem',
                            background: '#a855f720',
                            color: '#a855f7',
                            borderRadius: '0.25rem',
                            fontSize: '0.8rem',
                          }}>{v}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {soul.dislikes.length > 0 && (
                    <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '0.5rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        😤 Pet Peeves
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {soul.dislikes.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setEditingSoul(true)}
                  style={{
                    width: '100%',
                    marginTop: '1rem',
                    padding: '0.75rem',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  ✏️ Edit Personality
                </button>
              </div>
            ) : (
              /* Soul Editor */
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Archetype
                    </label>
                    <input
                      type="text"
                      value={soulDraft?.archetype || ''}
                      onChange={(e) => setSoulDraft(s => s ? { ...s, archetype: e.target.value } : s)}
                      placeholder="e.g., The meticulous detective"
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        Communication
                      </label>
                      <select
                        value={soulDraft?.traits.communication || 'friendly'}
                        onChange={(e) => setSoulDraft(s => s ? { ...s, traits: { ...s.traits, communication: e.target.value as any } } : s)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <option value="formal">Formal</option>
                        <option value="casual">Casual</option>
                        <option value="technical">Technical</option>
                        <option value="friendly">Friendly</option>
                        <option value="direct">Direct</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        Approach
                      </label>
                      <select
                        value={soulDraft?.traits.approach || 'pragmatic'}
                        onChange={(e) => setSoulDraft(s => s ? { ...s, traits: { ...s.traits, approach: e.target.value as any } } : s)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <option value="methodical">Methodical</option>
                        <option value="creative">Creative</option>
                        <option value="pragmatic">Pragmatic</option>
                        <option value="thorough">Thorough</option>
                        <option value="fast">Fast</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        Style
                      </label>
                      <select
                        value={soulDraft?.traits.style || 'balanced'}
                        onChange={(e) => setSoulDraft(s => s ? { ...s, traits: { ...s.traits, style: e.target.value as any } } : s)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <option value="verbose">Verbose</option>
                        <option value="concise">Concise</option>
                        <option value="balanced">Balanced</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Values (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={soulDraft?.values.join(', ') || ''}
                      onChange={(e) => setSoulDraft(s => s ? { ...s, values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) } : s)}
                      placeholder="e.g., Code quality, User experience, Performance"
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Catchphrases (one per line)
                    </label>
                    <textarea
                      value={soulDraft?.catchphrases.join('\n') || ''}
                      onChange={(e) => setSoulDraft(s => s ? { ...s, catchphrases: e.target.value.split('\n').filter(Boolean) } : s)}
                      placeholder='Let me look into that...&#10;Here&#39;s what I&#39;m thinking:'
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button
                    onClick={() => { setEditingSoul(false); setSoulDraft(soul); }}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                    }}
                  >Cancel</button>
                  <button
                    onClick={saveSoul}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >💾 Save Personality</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add Memory Tab */}
        {activeTab === 'add' && (
          <div>
            <div style={{
              padding: '1rem',
              background: 'var(--bg-primary)',
              borderRadius: '0.5rem',
              marginBottom: '1rem',
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                💡 <strong>Tip:</strong> You can also add memories by chatting! Just say "@{persona.name}, remember that..." in any conversation.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Category
                </label>
                <select
                  value={newMemory.category}
                  onChange={(e) => setNewMemory(m => ({ ...m, category: e.target.value as any }))}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([key, { label, emoji }]) => (
                    <option key={key} value={key}>{emoji} {label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  What should {persona.name} remember?
                </label>
                <textarea
                  value={newMemory.content}
                  onChange={(e) => setNewMemory(m => ({ ...m, content: e.target.value }))}
                  placeholder={`e.g., "I prefer small, focused PRs over large ones"`}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Importance
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['low', 'medium', 'high'] as const).map(imp => (
                    <button
                      key={imp}
                      onClick={() => setNewMemory(m => ({ ...m, importance: imp }))}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: newMemory.importance === imp ? IMPORTANCE_COLORS[imp] + '30' : 'var(--bg-primary)',
                        color: newMemory.importance === imp ? IMPORTANCE_COLORS[imp] : 'var(--text-secondary)',
                        border: `1px solid ${newMemory.importance === imp ? IMPORTANCE_COLORS[imp] : 'var(--border)'}`,
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontWeight: newMemory.importance === imp ? 600 : 400,
                        textTransform: 'capitalize',
                      }}
                    >{imp}</button>
                  ))}
                </div>
              </div>

              <button
                onClick={addMemoryEntry}
                disabled={!newMemory.content.trim()}
                style={{
                  padding: '0.75rem',
                  background: newMemory.content.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: newMemory.content.trim() ? 'white' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: newMemory.content.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 500,
                  fontSize: '0.95rem',
                }}
              >
                ➕ Add Memory
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .trait-badge {
          padding: 0.25rem 0.6rem;
          border-radius: 0.25rem;
          font-size: 0.8rem;
          font-weight: 500;
          text-transform: capitalize;
        }
      `}</style>
    </div>
  );
}

export default PersonaMemoryPanel;
