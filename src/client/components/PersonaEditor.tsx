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
  'mobile', 'web', 'cloud', 'aws', 'docker', 'kubernetes', 'ci-cd'
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
  const [previewMode, setPreviewMode] = useState(false);

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
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addSpecialty = (specialty: string) => {
    const normalizedSpecialty = specialty.toLowerCase().trim();
    if (normalizedSpecialty && !formData.specialties.includes(normalizedSpecialty)) {
      setFormData(prev => ({
        ...prev,
        specialties: [...prev.specialties, normalizedSpecialty]
      }));
    }
    setCustomSpecialty('');
  };

  const removeSpecialty = (specialty: string) => {
    setFormData(prev => ({
      ...prev,
      specialties: prev.specialties.filter(s => s !== specialty)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      await onSave(formData);
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setSaving(false);
    }
  };

  const renderPromptPreview = () => {
    if (!formData.prompt) return <p className="text-gray-500 italic">No prompt yet...</p>;
    
    return (
      <div className="prose prose-sm max-w-none">
        {formData.prompt.split('\n').map((line, index) => {
          if (line.startsWith('#')) {
            const level = line.match(/^#+/)?.[0].length || 1;
            const text = line.replace(/^#+\s*/, '');
            const Tag = `h${Math.min(level, 6)}` as keyof JSX.IntrinsicElements;
            return <Tag key={index} className="text-gray-800 font-semibold">{text}</Tag>;
          } else if (line.trim() === '') {
            return <br key={index} />;
          } else if (line.match(/^\d+\./)) {
            return <li key={index} className="text-gray-700">{line.replace(/^\d+\.\s*/, '')}</li>;
          } else {
            return <p key={index} className="text-gray-700">{line}</p>;
          }
        })}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            {persona ? 'Edit Persona' : 'Create New Persona'}
          </h1>
          <p className="text-gray-600 mt-2">
            {persona ? `Editing ${persona.name}` : 'Design a new AI personality for task automation'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors duration-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !formData.name || !formData.prompt}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-6 rounded-lg transition-colors duration-200"
          >
            {saving ? 'Saving...' : (persona ? 'Update Persona' : 'Create Persona')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form Panel */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Persona Details</h2>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name and Emoji */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Senior Developer"
                  required
                />
              </div>
              
              <div>
                <label htmlFor="emoji" className="block text-sm font-medium text-gray-700 mb-2">
                  Emoji
                </label>
                <div className="flex flex-wrap gap-1">
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleInputChange('emoji', emoji)}
                      className={`w-8 h-8 text-lg rounded hover:bg-gray-100 transition-colors duration-200 ${
                        formData.emoji === emoji ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Brief description of what this persona specializes in..."
              />
            </div>

            {/* Specialties */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Specialties
              </label>
              
              {/* Current specialties */}
              {formData.specialties.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {formData.specialties.map(specialty => (
                    <span
                      key={specialty}
                      className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-blue-700 bg-blue-100 rounded-full"
                    >
                      {specialty}
                      <button
                        type="button"
                        onClick={() => removeSpecialty(specialty)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              
              {/* Add specialty */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={customSpecialty}
                  onChange={(e) => setCustomSpecialty(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSpecialty(customSpecialty))}
                  className="flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add custom specialty..."
                />
                <button
                  type="button"
                  onClick={() => addSpecialty(customSpecialty)}
                  disabled={!customSpecialty.trim()}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 rounded transition-colors duration-200"
                >
                  Add
                </button>
              </div>
              
              {/* Common specialties */}
              <div className="flex flex-wrap gap-1">
                {COMMON_SPECIALTIES
                  .filter(s => !formData.specialties.includes(s))
                  .slice(0, 12)
                  .map(specialty => (
                    <button
                      key={specialty}
                      type="button"
                      onClick={() => addSpecialty(specialty)}
                      className="px-2 py-1 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-200"
                    >
                      + {specialty}
                    </button>
                  ))}
              </div>
            </div>
          </form>
        </div>

        {/* Prompt Panel */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">System Prompt</h2>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setPreviewMode(false)}
                className={`px-3 py-1 text-sm font-medium transition-colors duration-200 ${
                  !previewMode 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode(true)}
                className={`px-3 py-1 text-sm font-medium transition-colors duration-200 ${
                  previewMode 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          <div className="h-96">
            {previewMode ? (
              <div className="h-full p-4 bg-gray-50 rounded-lg overflow-y-auto">
                {renderPromptPreview()}
              </div>
            ) : (
              <textarea
                value={formData.prompt}
                onChange={(e) => handleInputChange('prompt', e.target.value)}
                className="w-full h-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
                placeholder="Write the system prompt that defines how this persona behaves..."
                required
              />
            )}
          </div>
          
          <p className="text-xs text-gray-500 mt-2">
            This prompt defines how the AI persona will behave when working on tasks. 
            Be specific about the approach, style, and expected outputs.
          </p>
        </div>
      </div>
    </div>
  );
}