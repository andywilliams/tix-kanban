import React from 'react';
import { Persona } from '../types/index';

interface PersonaCardProps {
  persona: Persona;
  onEdit: () => void;
  onDelete: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete }: PersonaCardProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatCompletionTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="persona-card">
      <div className="persona-card-header">
        <div className="persona-card-identity">
          <span className="persona-card-emoji">{persona.emoji}</span>
          <div>
            <h3 className="persona-card-name">{persona.name}</h3>
            <p className="persona-card-id">ID: {persona.id}</p>
          </div>
        </div>
        <div className="persona-card-actions">
          <button onClick={onEdit} className="persona-card-btn" title="Edit persona">✏️</button>
          <button onClick={onDelete} className="persona-card-btn persona-card-btn-danger" title="Delete persona">🗑️</button>
        </div>
      </div>

      <p className="persona-card-description">{persona.description}</p>

      {persona.specialties.length > 0 && (
        <div className="persona-card-specialties">
          {persona.specialties.slice(0, 3).map((specialty) => (
            <span key={specialty} className="persona-card-tag">{specialty}</span>
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
        <div className="persona-card-stat">
          <div className="persona-card-stat-value">
            {persona.stats.tasksCompleted > 0 ? `${Math.round(persona.stats.successRate)}%` : '-'}
          </div>
          <div className="persona-card-stat-label">Success</div>
        </div>
      </div>

      <div className="persona-card-footer">
        Created: {formatDate(persona.createdAt)}
      </div>
    </div>
  );
}
