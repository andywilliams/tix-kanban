import React, { useState } from 'react';
import { Persona } from '../types/index';
import { usePersonas } from '../hooks/usePersonas';
import { PersonaCard } from './PersonaCard';
import { PersonaEditor } from './PersonaEditor';
import { SoulEditor } from './SoulEditor';
import { MemoryViewer } from './MemoryViewer';

export function PersonasPage() {
  const { personas, loading, error, createPersona, updatePersona, deletePersona } = usePersonas();
  const [isCreating, setIsCreating] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [editingSoulPersona, setEditingSoulPersona] = useState<Persona | null>(null);
  const [viewingMemoryPersona, setViewingMemoryPersona] = useState<Persona | null>(null);

  const handleCreate = () => { setEditingPersona(null); setIsCreating(true); };
  const handleEdit = (persona: Persona) => { setEditingPersona(persona); setIsCreating(false); };
  const handleCancel = () => { setIsCreating(false); setEditingPersona(null); };

  const handleSave = async (personaData: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingPersona) await updatePersona(editingPersona.id, personaData);
      else await createPersona(personaData);
      setIsCreating(false);
      setEditingPersona(null);
    } catch {}
  };

  const handleDelete = async (personaId: string) => {
    if (window.confirm('Delete this persona? This cannot be undone.')) {
      try { await deletePersona(personaId); } catch {}
    }
  };

  if (loading) {
    return (
      <div className="personas-loading">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading personas...</p>
      </div>
    );
  }

  if (isCreating || editingPersona) {
    return (
      <div className="personas-container">
        <PersonaEditor persona={editingPersona} onSave={handleSave} onCancel={handleCancel} />
      </div>
    );
  }

  return (
    <div className="personas-container">
      <div className="personas-header">
        <div>
          <h1 className="personas-title">🤖 AI Team</h1>
          <p className="personas-subtitle">
            Your AI team members with distinct personalities and memories
          </p>
        </div>
        <button onClick={handleCreate} className="personas-create-btn">+ Create Persona</button>
      </div>

      {/* Team Overview */}
      <div className="team-overview">
        <div className="team-overview-stats">
          <div className="team-stat">
            <span className="team-stat-value">{personas.length}</span>
            <span className="team-stat-label">Team Members</span>
          </div>
          <div className="team-stat">
            <span className="team-stat-value">
              {personas.reduce((sum, p) => sum + p.stats.tasksCompleted, 0)}
            </span>
            <span className="team-stat-label">Total Tasks</span>
          </div>
          <div className="team-stat">
            <span className="team-stat-value">
              {personas.length > 0 
                ? Math.round(personas.reduce((sum, p) => sum + (p.stats.ratings?.good || 0), 0) / 
                    Math.max(1, personas.reduce((sum, p) => sum + (p.stats.ratings?.total || 0), 0)) * 100) || 0
                : 0}%
            </span>
            <span className="team-stat-label">Approval Rate</span>
          </div>
        </div>
        <p className="team-overview-tip">
          💡 Tip: Use @PersonaName in chat to talk directly with team members. 
          Say "@Developer, remember that I prefer TypeScript" to save to their memory!
        </p>
      </div>

      {error && (
        <div className="personas-error">
          <p style={{ fontWeight: 500, margin: 0 }}>Error loading personas</p>
          <p style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{error}</p>
        </div>
      )}

      {personas.length === 0 ? (
        <div className="personas-empty">
          <div className="personas-empty-emoji">🤖</div>
          <h2>No team members yet</h2>
          <p>Create your first AI team member to start automating tasks</p>
          <button onClick={handleCreate} className="personas-create-btn">Create First Persona</button>
        </div>
      ) : (
        <div className="personas-grid">
          {personas.map((persona) => (
            <PersonaCard 
              key={persona.id} 
              persona={persona}
              onEdit={() => handleEdit(persona)} 
              onDelete={() => handleDelete(persona.id)}
              onEditSoul={() => setEditingSoulPersona(persona)}
              onViewMemory={() => setViewingMemoryPersona(persona)}
              onChat={() => {
                // This would open the chat panel - for now just alert
                alert(`Start chatting with ${persona.name} in the Team Chat panel!`);
              }}
            />
          ))}
        </div>
      )}

      {/* Soul Editor Modal */}
      {editingSoulPersona && (
        <SoulEditor
          personaId={editingSoulPersona.id}
          personaName={editingSoulPersona.name}
          allPersonas={personas}
          onClose={() => setEditingSoulPersona(null)}
        />
      )}

      {/* Memory Viewer Modal */}
      {viewingMemoryPersona && (
        <MemoryViewer
          personaId={viewingMemoryPersona.id}
          personaName={viewingMemoryPersona.name}
          personaEmoji={viewingMemoryPersona.emoji}
          onClose={() => setViewingMemoryPersona(null)}
        />
      )}
    </div>
  );
}
