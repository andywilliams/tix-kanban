import React, { useState, useEffect } from 'react';
import { Persona } from '../types/index';

interface PersonaEditorProps {
  persona?: Persona | null;
  onSave: (personaData: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}

const COMMON_SPECIALTIES = [
  'javascript', 'typescript', 'react', 'nodejs', 'python', 'api-design',
  'debugging', 'testing', 'documentation', 'technical-writing', 'ui-ux',
  'database', 'sql', 'backend', 'frontend', 'full-stack', 'devops',
  'security', 'performance', 'code-review', 'refactoring', 'architecture',
];

const EMOJI_OPTIONS = [
  '🤖', '👨‍💻', '👩‍💻', '🔧', '🐛', '📝', '🎨', '🔍', '🚀', '⚡',
  '🛡️', '📊', '🧪', '🔬', '📋', '🎯', '💡', '🏗️', '🌟', '🦾'
];

export function PersonaEditor({ persona, onSave, onCancel }: PersonaEditorProps) {
  const [formData, setFormData] = useState({
    name: '',
    emoji: '🤖',
    description: '',
    specialties: [] as string[],
    prompt: '',
    stats: { tasksCompleted: 0, averageCompletionTime: 0, successRate: 0 }
  });
  const [customSpecialty, setCustomSpecialty] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (persona) {
      setFormData({
        name: persona.name,
        emoji: persona.emoji,
        description: persona.description,
        specialties: [...persona.specialties],
        prompt: persona.prompt,
        stats: persona.stats
      });
    }
  }, [persona]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addSpecialty = (specialty: string) => {
    const s = specialty.toLowerCase().trim();
    if (s && !formData.specialties.includes(s)) {
      setFormData(prev => ({ ...prev, specialties: [...prev.specialties, s] }));
    }
    setCustomSpecialty('');
  };

  const removeSpecialty = (specialty: string) => {
    setFormData(prev => ({ ...prev, specialties: prev.specialties.filter(s => s !== specialty) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div>
          <h1 className="editor-title">{persona ? 'Edit Persona' : 'Create New Persona'}</h1>
          <p className="editor-subtitle">
            {persona ? `Editing ${persona.name}` : 'Design a new AI personality for task automation'}
          </p>
        </div>
        <div className="editor-actions">
          <button onClick={onCancel} className="editor-btn-cancel">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !formData.name || !formData.prompt}
            className="editor-btn-save"
          >
            {saving ? 'Saving...' : (persona ? 'Update Persona' : 'Create Persona')}
          </button>
        </div>
      </div>

      <div className="editor-panels">
        {/* Details Panel */}
        <div className="editor-panel">
          <h2 className="editor-panel-title">Persona Details</h2>
          
          <form onSubmit={handleSubmit}>
            <div className="editor-field">
              <label className="editor-label">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="editor-input"
                placeholder="e.g., Senior Developer"
                required
              />
            </div>

            <div className="editor-field">
              <label className="editor-label">Emoji</label>
              <div className="editor-emoji-grid">
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleInputChange('emoji', emoji)}
                    className={`editor-emoji-btn ${formData.emoji === emoji ? 'selected' : ''}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="editor-field">
              <label className="editor-label">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={2}
                className="editor-input editor-textarea"
                placeholder="Brief description of what this persona specializes in..."
              />
            </div>

            <div className="editor-field">
              <label className="editor-label">Specialties</label>
              {formData.specialties.length > 0 && (
                <div className="editor-specialty-list">
                  {formData.specialties.map(s => (
                    <span key={s} className="editor-specialty-tag">
                      {s}
                      <button type="button" onClick={() => removeSpecialty(s)} className="editor-specialty-remove">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="editor-specialty-add">
                <input
                  type="text"
                  value={customSpecialty}
                  onChange={(e) => setCustomSpecialty(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSpecialty(customSpecialty))}
                  className="editor-input"
                  placeholder="Add custom specialty..."
                />
                <button type="button" onClick={() => addSpecialty(customSpecialty)} disabled={!customSpecialty.trim()} className="editor-btn-add">Add</button>
              </div>
              <div className="editor-common-specialties">
                {COMMON_SPECIALTIES.filter(s => !formData.specialties.includes(s)).slice(0, 12).map(s => (
                  <button key={s} type="button" onClick={() => addSpecialty(s)} className="editor-common-tag">+ {s}</button>
                ))}
              </div>
            </div>
          </form>
        </div>

        {/* Prompt Panel */}
        <div className="editor-panel">
          <h2 className="editor-panel-title">System Prompt *</h2>
          <textarea
            value={formData.prompt}
            onChange={(e) => handleInputChange('prompt', e.target.value)}
            className="editor-input editor-prompt"
            placeholder="Write the system prompt that defines how this persona behaves..."
            required
          />
          <p className="editor-hint">
            This prompt defines how the AI persona will behave when working on tasks.
            Be specific about the approach, style, and expected outputs.
          </p>
        </div>
      </div>
    </div>
  );
}
