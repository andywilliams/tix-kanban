import React, { useState, useEffect } from 'react';
import { Pipeline, PipelineStage, PIPELINE_TEMPLATES } from '../types/pipeline';

interface PipelineEditorProps {
  isOpen: boolean;
  onClose: () => void;
  pipeline?: Pipeline | null;
  onSave: (pipeline: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

export default function PipelineEditor({ isOpen, onClose, pipeline, onSave }: PipelineEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (pipeline) {
      setName(pipeline.name);
      setDescription(pipeline.description || '');
      setStages(pipeline.stages);
      setIsActive(pipeline.isActive);
    } else {
      resetForm();
    }
  }, [pipeline]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setStages([]);
    setIsActive(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || stages.length === 0) return;

    onSave({
      name: name.trim(),
      description: description.trim(),
      stages,
      isActive
    });

    resetForm();
    onClose();
  };

  const addStage = () => {
    const newStage: PipelineStage = {
      id: Math.random().toString(36).substr(2, 8),
      name: `Stage ${stages.length + 1}`,
      persona: 'general-developer',
      autoAdvance: true,
      maxRetryAttempts: 3,
      action: {
        type: 'work',
        description: 'Complete the assigned work',
        outputRequirements: []
      }
    };
    setStages([...stages, newStage]);
  };

  const updateStage = (index: number, updates: Partial<PipelineStage>) => {
    const updatedStages = [...stages];
    updatedStages[index] = { ...updatedStages[index], ...updates };
    setStages(updatedStages);
  };

  const removeStage = (index: number) => {
    setStages(stages.filter((_, i) => i !== index));
  };

  const moveStage = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === stages.length - 1)
    ) return;

    const newStages = [...stages];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newStages[index], newStages[targetIndex]] = [newStages[targetIndex], newStages[index]];
    setStages(newStages);
  };

  const loadTemplate = (template: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>) => {
    setName(template.name);
    setDescription(template.description || '');
    setStages(template.stages);
    setIsActive(template.isActive);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="pipeline-editor-modal">
        <div className="modal-header">
          <h2>{pipeline ? 'Edit Pipeline' : 'Create Pipeline'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-section">
            <label>
              Pipeline Name:
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Standard Development"
                required
              />
            </label>

            <label>
              Description:
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this pipeline"
                rows={2}
              />
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
          </div>

          <div className="form-section">
            <h3>Templates</h3>
            <div className="template-buttons">
              {PIPELINE_TEMPLATES.map((template, index) => (
                <button
                  key={index}
                  type="button"
                  className="template-button"
                  onClick={() => loadTemplate(template)}
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="section-header">
              <h3>Stages ({stages.length})</h3>
              <button type="button" className="add-stage-button" onClick={addStage}>
                + Add Stage
              </button>
            </div>

            <div className="stages-list">
              {stages.map((stage, index) => (
                <div key={stage.id} className="stage-item">
                  <div className="stage-header">
                    <span className="stage-number">{index + 1}</span>
                    <input
                      type="text"
                      value={stage.name}
                      onChange={(e) => updateStage(index, { name: e.target.value })}
                      className="stage-name-input"
                    />
                    <div className="stage-controls">
                      <button
                        type="button"
                        onClick={() => moveStage(index, 'up')}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStage(index, 'down')}
                        disabled={index === stages.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStage(index)}
                        className="remove-stage"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="stage-details">
                    <div className="stage-row">
                      <label>
                        Persona:
                        <select
                          value={stage.persona}
                          onChange={(e) => updateStage(index, { persona: e.target.value })}
                        >
                          <option value="general-developer">General-Developer 💻</option>
                          <option value="tech-writer">Tech-Writer 📝</option>
                          <option value="bug-fixer">Bug-Fixer 🐛</option>
                          <option value="qa-engineer">QA-Engineer 🔍</option>
                          <option value="security-reviewer">Security-Reviewer 🔒</option>
                        </select>
                      </label>

                      <label>
                        Action Type:
                        <select
                          value={stage.action.type}
                          onChange={(e) => updateStage(index, {
                            action: { ...stage.action, type: e.target.value as any }
                          })}
                        >
                          <option value="work">Work</option>
                          <option value="review">Review</option>
                          <option value="test">Test</option>
                          <option value="deploy">Deploy</option>
                          <option value="custom">Custom</option>
                        </select>
                      </label>

                      <label>
                        Max Retries:
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={stage.maxRetryAttempts}
                          onChange={(e) => updateStage(index, { maxRetryAttempts: parseInt(e.target.value) })}
                        />
                      </label>
                    </div>

                    <div className="stage-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={stage.autoAdvance}
                          onChange={(e) => updateStage(index, { autoAdvance: e.target.checked })}
                        />
                        Auto-advance on completion
                      </label>
                    </div>

                    <label>
                      Action Description:
                      <textarea
                        value={stage.action.description}
                        onChange={(e) => updateStage(index, {
                          action: { ...stage.action, description: e.target.value }
                        })}
                        placeholder="What should this stage accomplish?"
                        rows={2}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="cancel-button">
              Cancel
            </button>
            <button type="submit" className="save-button">
              {pipeline ? 'Update' : 'Create'} Pipeline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}