import React, { useState } from 'react';
import { Persona } from '../types/index';
import { usePersonas } from '../hooks/usePersonas';
import { PersonaCard } from './PersonaCard';
import { PersonaEditor } from './PersonaEditor';

export function PersonasPage() {
  const { personas, loading, error, createPersona, updatePersona, deletePersona } = usePersonas();
  const [isCreating, setIsCreating] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

  const handleCreate = () => {
    setEditingPersona(null);
    setIsCreating(true);
  };

  const handleEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setIsCreating(false);
  };

  const handleSave = async (personaData: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingPersona) {
        await updatePersona(editingPersona.id, personaData);
      } else {
        await createPersona(personaData);
      }
      setIsCreating(false);
      setEditingPersona(null);
    } catch (err) {
      // Error handling is done in the hook
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingPersona(null);
  };

  const handleDelete = async (personaId: string) => {
    if (window.confirm('Are you sure you want to delete this persona? This action cannot be undone.')) {
      try {
        await deletePersona(personaId);
      } catch (err) {
        // Error handling is done in the hook
      }
    }
  };

  if (loading) {
    return (
      <div className="personas-loading">
        <p>🔄 Loading personas...</p>
      </div>
    );
  }

  if (isCreating || editingPersona) {
    return (
      <div className="personas-container">
        <PersonaEditor
          persona={editingPersona}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return (
    <div className="personas-container">
      <div className="personas-header">
        <div>
          <h1 className="personas-title">AI Personas</h1>
          <p className="personas-subtitle">Manage AI personalities that handle different types of tasks</p>
        </div>
        <button onClick={handleCreate} className="personas-create-btn">+ Create Persona</button>
      </div>

      {error && (
        <div className="personas-error">
          <p><strong>Error loading personas</strong></p>
          <p>{error}</p>
        </div>
      )}

      {personas.length === 0 ? (
        <div className="personas-empty">
          <div className="personas-empty-emoji">🤖</div>
          <h2>No personas yet</h2>
          <p>Create your first AI persona to start automating tasks</p>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
