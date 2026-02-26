import React, { useState, useEffect } from 'react';
import { AgentSoul, PersonalityTrait, CommunicationStyle, TeamRelationship, Persona } from '../types';
import { useAgentSoul } from '../hooks/useAgentSoul';

interface SoulEditorProps {
  personaId: string;
  personaName: string;
  allPersonas: Persona[];
  onClose: () => void;
}

const TRAIT_SUGGESTIONS = [
  'analytical', 'creative', 'methodical', 'empathetic', 'pragmatic',
  'curious', 'patient', 'enthusiastic', 'meticulous', 'adaptable',
  'focused', 'collaborative', 'independent', 'thorough', 'innovative'
];

const QUIRK_SUGGESTIONS = [
  'Uses lots of emojis',
  'Makes programming jokes',
  'References movies/pop culture',
  'Gets excited about elegant solutions',
  'Has strong opinions about code style',
  'Tends to ask clarifying questions first',
  'Likes to explain the "why" behind things'
];

export function SoulEditor({ personaId, personaName, allPersonas, onClose }: SoulEditorProps) {
  const { soul, loading, error, updateSoul } = useAgentSoul(personaId);
  const [editedSoul, setEditedSoul] = useState<Partial<AgentSoul>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'identity' | 'personality' | 'style' | 'team' | 'behavior'>('identity');
  const [saving, setSaving] = useState(false);

  // New item inputs
  const [newValue, setNewValue] = useState('');
  const [newExpertise, setNewExpertise] = useState('');
  const [newQuirk, setNewQuirk] = useState('');
  const [newCatchphrase, setNewCatchphrase] = useState('');
  const [newTrait, setNewTrait] = useState({ name: '', intensity: 5, description: '' });
  const [newAlwaysDo, setNewAlwaysDo] = useState('');
  const [newNeverDo, setNewNeverDo] = useState('');

  useEffect(() => {
    if (soul) {
      setEditedSoul(soul);
    }
  }, [soul]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSoul(editedSoul);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save soul:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof AgentSoul>(field: K, value: AgentSoul[K]) => {
    setEditedSoul(prev => ({ ...prev, [field]: value }));
  };

  const addToArray = (field: 'values' | 'expertise' | 'quirks' | 'catchphrases' | 'alwaysDo' | 'neverDo', value: string) => {
    if (!value.trim()) return;
    const current = editedSoul[field] || [];
    updateField(field, [...current, value.trim()]);
  };

  const removeFromArray = (field: 'values' | 'expertise' | 'quirks' | 'catchphrases' | 'alwaysDo' | 'neverDo', index: number) => {
    const current = editedSoul[field] || [];
    updateField(field, current.filter((_, i) => i !== index));
  };

  const addTrait = () => {
    if (!newTrait.name.trim()) return;
    const traits = editedSoul.traits || [];
    updateField('traits', [...traits, { ...newTrait, name: newTrait.name.trim() }]);
    setNewTrait({ name: '', intensity: 5, description: '' });
  };

  const removeTrait = (index: number) => {
    const traits = editedSoul.traits || [];
    updateField('traits', traits.filter((_, i) => i !== index));
  };

  const updateStyle = <K extends keyof CommunicationStyle>(key: K, value: CommunicationStyle[K]) => {
    const current = editedSoul.communicationStyle || {
      formality: 'balanced', verbosity: 'moderate', emoji: true, humor: 'occasional', technicalDepth: 'moderate'
    };
    updateField('communicationStyle', { ...current, [key]: value });
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading personality...</p>
      </div>
    );
  }

  const style = editedSoul.communicationStyle || soul?.communicationStyle;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: '0.75rem',
        width: '90%', maxWidth: '800px', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid var(--border)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
              🧠 {personaName}'s Soul
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {isEditing ? 'Edit personality, communication style, and behavior' : 'Personality, communication style, and behavior'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose}
              style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
              {isEditing ? 'Cancel' : 'Close'}
            </button>
            {isEditing ? (
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 500 }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            ) : (
              <button onClick={() => setIsEditing(true)}
                style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 500 }}>
                Edit Soul
              </button>
            )}
          </div>
        </div>

        {/* Read-only summary view */}
        {!isEditing && soul && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
            {/* Core Identity */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Core Purpose</div>
              <p style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{soul.corePurpose || 'Not set'}</p>
              {soul.teamRole && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--accent)', fontStyle: 'italic' }}>{soul.teamRole}</p>
              )}
            </div>

            {/* Values & Expertise */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Values</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {(soul.values || []).map((v, i) => (
                    <span key={i} style={{ padding: '0.2rem 0.5rem', background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', borderRadius: '0.25rem', fontSize: '0.8rem' }}>{v}</span>
                  ))}
                  {(!soul.values || soul.values.length === 0) && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>None set</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Expertise</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {(soul.expertise || []).map((e, i) => (
                    <span key={i} style={{ padding: '0.2rem 0.5rem', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', borderRadius: '0.25rem', fontSize: '0.8rem' }}>{e}</span>
                  ))}
                  {(!soul.expertise || soul.expertise.length === 0) && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>None set</span>}
                </div>
              </div>
            </div>

            {/* Personality Traits */}
            {soul.traits && soul.traits.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Personality Traits</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {soul.traits.map((trait, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: 500, minWidth: '100px', fontSize: '0.85rem' }}>{trait.name}</span>
                      <div style={{ flex: 1, height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${trait.intensity * 10}%`, height: '100%', background: 'var(--accent)', borderRadius: '3px' }} />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '1.5rem', textAlign: 'right' }}>{trait.intensity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Communication Style */}
            {soul.communicationStyle && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Communication Style</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '1rem', fontSize: '0.8rem' }}>
                    {soul.communicationStyle.formality === 'casual' ? '😊 Casual' : soul.communicationStyle.formality === 'formal' ? '🎩 Formal' : '💼 Balanced'}
                  </span>
                  <span style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '1rem', fontSize: '0.8rem' }}>
                    {soul.communicationStyle.verbosity === 'concise' ? '📝 Concise' : soul.communicationStyle.verbosity === 'detailed' ? '📚 Detailed' : '📄 Moderate'}
                  </span>
                  <span style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '1rem', fontSize: '0.8rem' }}>
                    {soul.communicationStyle.technicalDepth === 'simple' ? '🌱 Simple' : soul.communicationStyle.technicalDepth === 'deep' ? '🔬 Deep' : '⚙️ Moderate'}
                  </span>
                  {soul.communicationStyle.humor !== 'none' && (
                    <span style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '1rem', fontSize: '0.8rem' }}>
                      😄 {soul.communicationStyle.humor === 'frequent' ? 'Frequent humor' : 'Occasional humor'}
                    </span>
                  )}
                  {soul.communicationStyle.emoji && (
                    <span style={{ padding: '0.25rem 0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '1rem', fontSize: '0.8rem' }}>
                      ✨ Uses emoji
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Quirks & Catchphrases */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
              {soul.quirks && soul.quirks.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Quirks</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {soul.quirks.map((q, i) => (
                      <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              {soul.catchphrases && soul.catchphrases.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Catchphrases</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', listStyle: 'none' }}>
                    {soul.catchphrases.map((p, i) => (
                      <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '0.25rem' }}>"{p}"</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Behavioral Guidelines */}
            {((soul.alwaysDo && soul.alwaysDo.length > 0) || (soul.neverDo && soul.neverDo.length > 0)) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
                {soul.alwaysDo && soul.alwaysDo.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Always Do</div>
                    {soul.alwaysDo.map((a, i) => (
                      <div key={i} style={{ padding: '0.35rem 0.6rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '0.25rem', fontSize: '0.85rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                        {a}
                      </div>
                    ))}
                  </div>
                )}
                {soul.neverDo && soul.neverDo.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Never Do</div>
                    {soul.neverDo.map((n, i) => (
                      <div key={i} style={{ padding: '0.35rem 0.6rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.25rem', fontSize: '0.85rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                        {n}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Team Relationships */}
            {soul.relationships && soul.relationships.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Team Relationships</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {soul.relationships.map((rel, i) => {
                    const relPersona = allPersonas.find(p => p.id === rel.personaId);
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.375rem' }}>
                        <span>{relPersona?.emoji || '?'}</span>
                        <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>{relPersona?.name || rel.personaId}</span>
                        <span style={{ padding: '0.15rem 0.4rem', background: 'var(--bg-tertiary)', borderRadius: '0.25rem', fontSize: '0.7rem', textTransform: 'capitalize' }}>{rel.relationship}</span>
                        {rel.dynamicNote && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>— {rel.dynamicNote}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs (edit mode only) */}
        {isEditing && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 1rem' }}>
          {(['identity', 'personality', 'style', 'team', 'behavior'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.75rem 1rem', background: 'none', border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize'
              }}>
              {tab}
            </button>
          ))}
        </div>
        )}

        {/* Content (edit mode only) */}
        {isEditing && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {error && (
            <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.375rem', marginBottom: '1rem', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}

          {/* Identity Tab */}
          {activeTab === 'identity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Core Purpose
                </label>
                <input
                  type="text"
                  value={editedSoul.corePurpose || ''}
                  onChange={(e) => updateField('corePurpose', e.target.value)}
                  placeholder="What is this persona's main purpose?"
                  style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Team Role
                </label>
                <input
                  type="text"
                  value={editedSoul.teamRole || ''}
                  onChange={(e) => updateField('teamRole', e.target.value)}
                  placeholder="e.g., Technical lead, Quality guardian"
                  style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Values
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.values || []).map((v, i) => (
                    <span key={i} style={{ padding: '0.25rem 0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {v}
                      <button onClick={() => removeFromArray('values', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('values', newValue), setNewValue(''))}
                    placeholder="Add a value..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('values', newValue); setNewValue(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Expertise
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.expertise || []).map((e, i) => (
                    <span key={i} style={{ padding: '0.25rem 0.5rem', background: 'rgba(59, 130, 246, 0.2)', borderRadius: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {e}
                      <button onClick={() => removeFromArray('expertise', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newExpertise}
                    onChange={(e) => setNewExpertise(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('expertise', newExpertise), setNewExpertise(''))}
                    placeholder="Add expertise area..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('expertise', newExpertise); setNewExpertise(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Personality Tab */}
          {activeTab === 'personality' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                  Personality Traits
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  {(editedSoul.traits || []).map((trait, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '0.375rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{trait.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{trait.description}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Intensity:</span>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={trait.intensity}
                          onChange={(e) => {
                            const traits = [...(editedSoul.traits || [])];
                            traits[i] = { ...trait, intensity: parseInt(e.target.value) };
                            updateField('traits', traits);
                          }}
                          style={{ width: '80px' }}
                        />
                        <span style={{ fontSize: '0.75rem', width: '1.5rem' }}>{trait.intensity}</span>
                      </div>
                      <button onClick={() => removeTrait(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                    </div>
                  ))}
                </div>
                
                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '0.375rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      value={newTrait.name}
                      onChange={(e) => setNewTrait(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Trait name"
                      style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                    />
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={newTrait.intensity}
                      onChange={(e) => setNewTrait(prev => ({ ...prev, intensity: parseInt(e.target.value) || 5 }))}
                      style={{ width: '60px', padding: '0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      value={newTrait.description}
                      onChange={(e) => setNewTrait(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Description of this trait"
                      style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                    />
                    <button onClick={addTrait}
                      style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
                      Add Trait
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.75rem' }}>
                    {TRAIT_SUGGESTIONS.filter(t => !(editedSoul.traits || []).some(et => et.name.toLowerCase() === t)).slice(0, 8).map(t => (
                      <button key={t} onClick={() => setNewTrait(prev => ({ ...prev, name: t }))}
                        style={{ padding: '0.25rem 0.5rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Quirks
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.quirks || []).map((q, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem' }}>
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{q}</span>
                      <button onClick={() => removeFromArray('quirks', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newQuirk}
                    onChange={(e) => setNewQuirk(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('quirks', newQuirk), setNewQuirk(''))}
                    placeholder="Add a quirk..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('quirks', newQuirk); setNewQuirk(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
                  {QUIRK_SUGGESTIONS.filter(q => !(editedSoul.quirks || []).includes(q)).slice(0, 4).map(q => (
                    <button key={q} onClick={() => addToArray('quirks', q)}
                      style={{ padding: '0.25rem 0.5rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      + {q}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Catchphrases
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.catchphrases || []).map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem' }}>
                      <span style={{ flex: 1, fontSize: '0.85rem', fontStyle: 'italic' }}>"{p}"</span>
                      <button onClick={() => removeFromArray('catchphrases', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newCatchphrase}
                    onChange={(e) => setNewCatchphrase(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('catchphrases', newCatchphrase), setNewCatchphrase(''))}
                    placeholder="Add a catchphrase..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('catchphrases', newCatchphrase); setNewCatchphrase(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Style Tab */}
          {activeTab === 'style' && style && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Formality
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['casual', 'balanced', 'formal'] as const).map(f => (
                    <button key={f} onClick={() => updateStyle('formality', f)}
                      style={{
                        padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer',
                        background: style.formality === f ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: style.formality === f ? '#fff' : 'var(--text-secondary)',
                        textTransform: 'capitalize'
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Verbosity
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['concise', 'moderate', 'detailed'] as const).map(v => (
                    <button key={v} onClick={() => updateStyle('verbosity', v)}
                      style={{
                        padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer',
                        background: style.verbosity === v ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: style.verbosity === v ? '#fff' : 'var(--text-secondary)',
                        textTransform: 'capitalize'
                      }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Technical Depth
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['simple', 'moderate', 'deep'] as const).map(t => (
                    <button key={t} onClick={() => updateStyle('technicalDepth', t)}
                      style={{
                        padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer',
                        background: style.technicalDepth === t ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: style.technicalDepth === t ? '#fff' : 'var(--text-secondary)',
                        textTransform: 'capitalize'
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Humor
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['none', 'occasional', 'frequent'] as const).map(h => (
                    <button key={h} onClick={() => updateStyle('humor', h)}
                      style={{
                        padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer',
                        background: style.humor === h ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: style.humor === h ? '#fff' : 'var(--text-secondary)',
                        textTransform: 'capitalize'
                      }}>
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="useEmoji"
                  checked={style.emoji}
                  onChange={(e) => updateStyle('emoji', e.target.checked)}
                />
                <label htmlFor="useEmoji" style={{ color: 'var(--text-primary)' }}>Use emoji in responses</label>
              </div>
            </div>
          )}

          {/* Team Tab */}
          {activeTab === 'team' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Define how this persona relates to other team members.
              </p>
              
              {allPersonas.filter(p => p.id !== personaId).map(p => {
                const existing = (editedSoul.relationships || []).find(r => r.personaId === p.id);
                return (
                  <div key={p.id} style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '0.375rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>{p.emoji}</span>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {(['collaborator', 'mentor', 'mentee', 'peer', 'specialist'] as const).map(rel => (
                        <button key={rel} onClick={() => {
                          const relationships = (editedSoul.relationships || []).filter(r => r.personaId !== p.id);
                          if (existing?.relationship !== rel) {
                            relationships.push({ personaId: p.id, relationship: rel, dynamicNote: existing?.dynamicNote || '' });
                          }
                          updateField('relationships', relationships);
                        }}
                        style={{
                          padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: 'none', cursor: 'pointer',
                          background: existing?.relationship === rel ? 'var(--accent)' : 'var(--bg-tertiary)',
                          color: existing?.relationship === rel ? '#fff' : 'var(--text-secondary)',
                          fontSize: '0.8rem', textTransform: 'capitalize'
                        }}>
                          {rel}
                        </button>
                      ))}
                    </div>
                    {existing && (
                      <input
                        type="text"
                        value={existing.dynamicNote}
                        onChange={(e) => {
                          const relationships = editedSoul.relationships!.map(r =>
                            r.personaId === p.id ? { ...r, dynamicNote: e.target.value } : r
                          );
                          updateField('relationships', relationships);
                        }}
                        placeholder="How do they interact?"
                        style={{ width: '100%', marginTop: '0.5rem', padding: '0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Behavior Tab */}
          {activeTab === 'behavior' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ✅ Always Do
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.alwaysDo || []).map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '0.25rem' }}>
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{a}</span>
                      <button onClick={() => removeFromArray('alwaysDo', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newAlwaysDo}
                    onChange={(e) => setNewAlwaysDo(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('alwaysDo', newAlwaysDo), setNewAlwaysDo(''))}
                    placeholder="Add behavior..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('alwaysDo', newAlwaysDo); setNewAlwaysDo(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ❌ Never Do
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                  {(editedSoul.neverDo || []).map((n, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.25rem' }}>
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{n}</span>
                      <button onClick={() => removeFromArray('neverDo', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newNeverDo}
                    onChange={(e) => setNewNeverDo(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (addToArray('neverDo', newNeverDo), setNewNeverDo(''))}
                    placeholder="Add behavior..."
                    style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-primary)' }}
                  />
                  <button onClick={() => { addToArray('neverDo', newNeverDo); setNewNeverDo(''); }}
                    style={{ padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
