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

    // Load memory count
    fetch(`/api/personas/${persona.id}/agent-memory`)
      .then(res => res.json())
      .then(data => setMemoryCount(data.memory?.entries?.length || 0))
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
        <div className="persona-card-soul">
          {/* Traits */}
          {soul.traits.length > 0 && (
            <div className="persona-card-traits">
              {soul.traits.slice(0, 3).map((trait) => (
                <span key={trait.name} className="persona-card-trait" title={trait.description}>
                  {trait.name}
                  <span className="trait-intensity">{trait.intensity}</span>
                </span>
              ))}
            </div>
          )}
          
          {/* Catchphrase */}
          {soul.catchphrases[0] && (
            <div className="persona-card-catchphrase">
              "{soul.catchphrases[0]}"
            </div>
          )}
          
          {/* Style indicators */}
          <div className="persona-card-style">
            <span title="Formality">{soul.communicationStyle.formality === 'casual' ? '😊' : soul.communicationStyle.formality === 'formal' ? '🎩' : '💼'}</span>
            <span title="Verbosity">{soul.communicationStyle.verbosity === 'concise' ? '📝' : soul.communicationStyle.verbosity === 'detailed' ? '📚' : '📄'}</span>
            {soul.communicationStyle.humor !== 'none' && <span title="Uses humor">😄</span>}
            {soul.communicationStyle.emoji && <span title="Uses emoji">✨</span>}
          </div>
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
      <div className="persona-card-actions-row">
        {onEditSoul && (
          <button onClick={onEditSoul} className="persona-card-action-btn">
            🧠 Edit Soul
          </button>
        )}
        {onViewMemory && (
          <button onClick={onViewMemory} className="persona-card-action-btn">
            💾 View Memory
          </button>
        )}
      </div>

      <div className="persona-card-footer">Created: {formatDate(persona.createdAt)}</div>
    </div>
  );
}
