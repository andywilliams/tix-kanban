import React, { useState, useEffect } from 'react';
import { Persona, PersonaMood, AgentSoul } from '../types/index';

interface PersonaCardProps {
  persona: Persona;
  onEdit: () => void;
  onDelete: () => void;
  onEditSoul?: () => void;
  onViewMemory?: () => void;
  onChat?: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete, onEditSoul, onViewMemory, onChat }: PersonaCardProps) {
  const [mood, setMood] = useState<PersonaMood | null>(null);
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [memoryCount, setMemoryCount] = useState<number>(0);

  useEffect(() => {
    // Load mood
    fetch(`/api/personas/${persona.id}/mood`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setMood(data))
      .catch(() => {});

    // Load soul
    fetch(`/api/personas/${persona.id}/soul`)
      .then(res => res.json())
      .then(data => setSoul(data.soul))
      .catch(() => {});

    // Load memory count (aggregated across all users)
    fetch(`/api/personas/${persona.id}/memories`)
      .then(res => res.json())
      .then(data => setMemoryCount(data?.entries?.length || 0))
      .catch(() => {});
  }, [persona.id]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatCompletionTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getRatingDisplay = () => {
    const ratings = persona.stats.ratings;
    if (!ratings || ratings.total === 0) return null;
    
    const percentage = Math.round((ratings.good / ratings.total) * 100);
    const emoji = percentage >= 80 ? '🌟' : percentage >= 60 ? '👍' : '📈';
    
    return (
      <div className="persona-card-stat">
        <div className="persona-card-stat-value">{emoji} {percentage}%</div>
        <div className="persona-card-stat-label">Rating ({ratings.total})</div>
      </div>
    );
  };

  return (
    <div className="persona-card">
      <div className="persona-card-header">
        <div className="persona-card-identity">
          <span className="persona-card-emoji">{persona.emoji}</span>
          <div>
            <h3 className="persona-card-name">{persona.name}</h3>
            {soul?.teamRole && (
              <p className="persona-card-role">{soul.teamRole}</p>
            )}
          </div>
        </div>
        {mood && (
          <div 
            className="persona-card-mood"
            title={`${mood.statusMessage}\n${mood.affectsResponse}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem 0.5rem',
              background: 'var(--bg-tertiary)',
              borderRadius: '0.5rem',
              fontSize: '0.8rem',
            }}
          >
            <span>{mood.emoji}</span>
            <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {mood.current}
            </span>
          </div>
        )}
        <div className="persona-card-actions">
          {onChat && (
            <button onClick={onChat} className="persona-card-btn persona-card-btn-primary" title="Chat with persona">💬</button>
          )}
          <button onClick={onEdit} className="persona-card-btn" title="Edit persona">✏️</button>
          <button onClick={onDelete} className="persona-card-btn persona-card-btn-danger" title="Delete persona">🗑️</button>
        </div>
      </div>

      <p className="persona-card-description">{persona.description}</p>

      {/* Soul Preview */}
      {soul && (
        <div style={{
          margin: '0.75rem 0',
          padding: '0.75rem',
          background: 'var(--bg-tertiary)',
          borderRadius: '0.5rem',
        }}>
          {/* Traits */}
          {soul.traits && soul.traits.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
              {soul.traits.slice(0, 3).map((trait) => (
                <span key={trait.name} title={trait.description} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.2rem 0.6rem',
                  background: 'rgba(59, 130, 246, 0.12)',
                  borderRadius: '1rem',
                  fontSize: '0.75rem',
                  color: '#6ea8fe',
                  fontWeight: 500,
                }}>
                  {trait.name}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '1.2rem',
                    height: '1.2rem',
                    padding: '0 0.2rem',
                    background: 'rgba(59, 130, 246, 0.25)',
                    borderRadius: '0.6rem',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                  }}>{trait.intensity}</span>
                </span>
              ))}
            </div>
          )}

          {/* Catchphrase */}
          {soul.catchphrases && soul.catchphrases[0] && (
            <div style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              marginBottom: '0.5rem',
              paddingLeft: '0.5rem',
              borderLeft: '2px solid var(--border)',
            }}>
              "{soul.catchphrases[0]}"
            </div>
          )}

          {/* Style indicators */}
          {soul.communicationStyle && (
            <div style={{ display: 'flex', gap: '0.375rem', fontSize: '0.85rem' }}>
              <span title="Formality" style={{ cursor: 'help' }}>{soul.communicationStyle.formality === 'casual' ? '😊' : soul.communicationStyle.formality === 'formal' ? '🎩' : '💼'}</span>
              <span title="Verbosity" style={{ cursor: 'help' }}>{soul.communicationStyle.verbosity === 'concise' ? '📝' : soul.communicationStyle.verbosity === 'detailed' ? '📚' : '📄'}</span>
              {soul.communicationStyle.humor !== 'none' && <span title="Uses humor" style={{ cursor: 'help' }}>😄</span>}
              {soul.communicationStyle.emoji && <span title="Uses emoji" style={{ cursor: 'help' }}>✨</span>}
            </div>
          )}
        </div>
      )}

      {persona.specialties.length > 0 && (
        <div className="persona-card-specialties">
          {persona.specialties.slice(0, 3).map((s) => (
            <span key={s} className="persona-card-tag">{s}</span>
          ))}
          {persona.specialties.length > 3 && (
            <span className="persona-card-tag persona-card-tag-more">+{persona.specialties.length - 3} more</span>
          )}
        </div>
      )}

      <div className="persona-card-stats">
        <div className="persona-card-stat">
          <div className="persona-card-stat-value">{persona.stats.tasksCompleted}</div>
          <div className="persona-card-stat-label">Tasks</div>
        </div>
        <div className="persona-card-stat">
          <div className="persona-card-stat-value">
            {persona.stats.tasksCompleted > 0 ? formatCompletionTime(persona.stats.averageCompletionTime) : '-'}
          </div>
          <div className="persona-card-stat-label">Avg Time</div>
        </div>
        {getRatingDisplay() || (
          <div className="persona-card-stat">
            <div className="persona-card-stat-value">
              {persona.stats.tasksCompleted > 0 ? `${Math.round(persona.stats.successRate)}%` : '-'}
            </div>
            <div className="persona-card-stat-label">Success</div>
          </div>
        )}
        <div className="persona-card-stat">
          <div className="persona-card-stat-value">{memoryCount}</div>
          <div className="persona-card-stat-label">Memories</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border)',
      }}>
        {onEditSoul && (
          <button onClick={onEditSoul} style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            color: 'var(--text-muted)',
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            textAlign: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            🧠 View Soul
          </button>
        )}
        {onViewMemory && (
          <button onClick={onViewMemory} style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            color: 'var(--text-muted)',
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            textAlign: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            💾 View Memory
          </button>
        )}
      </div>

      <div className="persona-card-footer">Created: {formatDate(persona.createdAt)}</div>
    </div>
  );
}
