import React, { useState } from 'react';
import { Persona } from '../types/index';
import { usePersonas } from '../hooks/usePersonas';
import { PersonaCard } from './PersonaCard';
import { PersonaEditor } from './PersonaEditor';

export function PersonasPage() {
  const { personas, loading, error, createPersona, updatePersona, deletePersona } = usePersonas();
  const [isCreating, setIsCreating] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading personas...</p>
        </div>
      </div>
    );
  }

  if (isCreating || editingPersona) {
    return (
      <div className="container mx-auto px-4 py-8">
        <PersonaEditor
          persona={editingPersona}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">AI Personas</h1>
          <p className="text-gray-600">
            Manage AI personalities that handle different types of tasks
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <span>+</span>
          Create Persona
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          <p className="font-medium">Error loading personas</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {personas.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-xl font-semibold text-gray-600 mb-2">No personas yet</h2>
          <p className="text-gray-500 mb-6">
            Create your first AI persona to start automating tasks
          </p>
          <button
            onClick={handleCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors duration-200"
          >
            Create First Persona
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {personas.map((persona) => (
            <PersonaCard key={persona.id} persona={persona}
              onEdit={() => handleEdit(persona)} onDelete={() => handleDelete(persona.id)} />
          ))}
        </div>
      )}
    </div>
  );
}