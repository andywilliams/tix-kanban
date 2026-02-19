import React, { useState, useEffect } from 'react';
import { Persona, StructuredMemory, PersonaSoul, MemoryEntry } from '../types';
import { usePersonas } from '../hooks/usePersonas';

const CATEGORY_LABELS: Record<MemoryEntry['category'], { label: string; emoji: string; color: string }> = {
  preference: { label: 'Preference', emoji: '💜', color: '#a855f7' },
  instruction: { label: 'Instruction', emoji: '📋', color: '#3b82f6' },
  context: { label: 'Context', emoji: '💭', color: '#6b7280' },
  relationship: { label: 'Relationship', emoji: '🤝', color: '#10b981' },
  learning: { label: 'Learning', emoji: '📚', color: '#f59e0b' },
  reflection: { label: 'Reflection', emoji: '🔮', color: '#ec4899' },
};

interface PersonaWithMemory {
  persona: Persona;
  memory: StructuredMemory | null;
  soul: PersonaSoul | null;
  loading: boolean;
}

export function PersonaMemoriesPage() {
  const { personas, loading: personasLoading } = usePersonas();
  const [personaData, setPersonaData] = useState<PersonaWithMemory[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<MemoryEntry['category'] | 'all'>('all');

  useEffect(() => {
    if (personas.length > 0) {
      loadAllPersonaData();
    }
  }, [personas]);

  const loadAllPersonaData = async () => {
    const data = await Promise.all(
      personas.map(async (persona) => {
        try {
          const [memRes, soulRes] = await Promise.all([
            fetch(`/api/personas/${persona.id}/memories`),
            fetch(`/api/personas/${persona.id}/soul`),
          ]);
          
          return {
            persona,
            memory: memRes.ok ? await memRes.json() : null,
            soul: soulRes.ok ? await soulRes.json() : null,
            loading: false,
          };
        } catch {
          return { persona, memory: null, soul: null, loading: false };
        }
      })
    );
    setPersonaData(data);
    if (data.length > 0 && !selectedPersona) {
      setSelectedPersona(data[0].persona.id);
    }
  };

  const deleteMemory = async (personaId: string, entryId: string) => {
    try {
      await fetch(`/api/personas/${personaId}/memories/${entryId}`, { method: 'DELETE' });
      loadAllPersonaData();
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  const selectedData = personaData.find(p => p.persona.id === selectedPersona);
  
  const filteredEntries = selectedData?.memory?.entries.filter(entry => {
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

  // Stats
  const totalMemories = personaData.reduce((sum, p) => sum + (p.memory?.entries.length || 0), 0);
  const categoryCounts = personaData.reduce((acc, p) => {
    p.memory?.entries.forEach(e => {
      acc[e.category] = (acc[e.category] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);

  if (personasLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading personas...
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', fontWeight: 600 }}>
          🧠 Team Memories
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          What your AI team members remember about you and your preferences
        </p>
      </div>

      {/* Stats Bar */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
      }}>
        <div style={{
          padding: '1rem 1.5rem',
          background: 'var(--bg-secondary)',
          borderRadius: '0.75rem',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{totalMemories}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Memories</div>
        </div>
        {Object.entries(CATEGORY_LABELS).map(([key, { label, emoji, color }]) => (
          <div
            key={key}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--bg-secondary)',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ fontSize: '1rem' }}>{emoji}</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 600, color }}>{categoryCounts[key] || 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem' }}>
        {/* Persona Sidebar */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '0.75rem',
          border: '1px solid var(--border)',
          padding: '1rem',
          height: 'fit-content',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Select Persona
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {personaData.map(({ persona, memory, soul }) => (
              <button
                key={persona.id}
                onClick={() => setSelectedPersona(persona.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  background: selectedPersona === persona.id ? 'var(--accent)' : 'var(--bg-primary)',
                  color: selectedPersona === persona.id ? 'white' : 'var(--text-primary)',
                  border: '1px solid',
                  borderColor: selectedPersona === persona.id ? 'var(--accent)' : 'var(--border)',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>{persona.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{persona.name}</div>
                  <div style={{
                    fontSize: '0.75rem',
                    opacity: 0.7,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {soul?.archetype || persona.description}
                  </div>
                </div>
                <div style={{
                  background: selectedPersona === persona.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-tertiary)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}>
                  {memory?.entries.length || 0}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Memory Content */}
        <div>
          {selectedData && (
            <>
              {/* Persona Header */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: '0.75rem',
                border: '1px solid var(--border)',
                padding: '1.5rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1.5rem',
              }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2.5rem',
                }}>
                  {selectedData.persona.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>{selectedData.persona.name}</h2>
                  {selectedData.soul && (
                    <p style={{ margin: '0 0 0.5rem', color: 'var(--accent)', fontStyle: 'italic' }}>
                      "{selectedData.soul.archetype}"
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {selectedData.persona.description}
                  </p>
                  {selectedData.soul && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '0.2rem 0.5rem',
                        background: '#3b82f620',
                        color: '#3b82f6',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                      }}>{selectedData.soul.traits.communication}</span>
                      <span style={{
                        padding: '0.2rem 0.5rem',
                        background: '#10b98120',
                        color: '#10b981',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                      }}>{selectedData.soul.traits.approach}</span>
                      {selectedData.soul.values.slice(0, 3).map((v, i) => (
                        <span key={i} style={{
                          padding: '0.2rem 0.5rem',
                          background: '#a855f720',
                          color: '#a855f7',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                        }}>{v}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div style={{
                display: 'flex',
                gap: '0.75rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search memories..."
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
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
                  padding: '3rem',
                  textAlign: 'center',
                  background: 'var(--bg-secondary)',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧠</div>
                  <h3 style={{ margin: '0 0 0.5rem' }}>No memories yet</h3>
                  <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                    Start a conversation and say "@{selectedData.persona.name}, remember that..."
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
                          padding: '1rem 1.25rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--border)',
                          borderLeft: `4px solid ${cat.color}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <span>{cat.emoji}</span>
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
                              fontSize: '0.95rem',
                              color: 'var(--text-primary)',
                              lineHeight: 1.5,
                            }}>{entry.content}</p>
                            <p style={{
                              margin: '0.5rem 0 0',
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}>
                              From <strong>{entry.source}</strong> • {new Date(entry.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                            onClick={() => deleteMemory(selectedData.persona.id, entry.id)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              opacity: 0.5,
                              transition: 'opacity 0.2s',
                            }}
                            onMouseEnter={(e) => (e.target as HTMLElement).style.opacity = '1'}
                            onMouseLeave={(e) => (e.target as HTMLElement).style.opacity = '0.5'}
                            title="Delete memory"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PersonaMemoriesPage;
