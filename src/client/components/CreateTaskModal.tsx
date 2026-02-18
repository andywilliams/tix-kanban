import React, { useState } from 'react';
import { Task, Persona } from '../types';

interface CreateTaskModalProps {
  personas: Persona[];
  onClose: () => void;
  onSubmit: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({ personas, onClose, onSubmit }) => {
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    status: 'backlog' as Task['status'],
    priority: 50,
    persona: '',
    tags: [] as string[],
    dueDate: undefined as Date | undefined,
    estimate: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    onSubmit({
      title: newTask.title.trim(),
      description: newTask.description.trim(),
      status: newTask.status,
      priority: newTask.priority,
      persona: newTask.persona || undefined,
      model: (newTask as any).model || undefined,
      tags: newTask.tags,
      dueDate: newTask.dueDate,
      estimate: newTask.estimate.trim() || undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content create-task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Task</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Title *</label>
              <input
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Enter task title..."
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder="Describe the task..."
                rows={4}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Status</label>
                <select
                  value={newTask.status}
                  onChange={(e) => setNewTask({ 
                    ...newTask, 
                    status: e.target.value as Task['status'] 
                  })}
                >
                  <option value="backlog">Backlog</option>
                  <option value="in-progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div className="form-group">
                <label>Priority</label>
                <input
                  type="number"
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ 
                    ...newTask, 
                    priority: parseInt(e.target.value) || 0 
                  })}
                  min="0"
                  max="200"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Assign to Persona</label>
              <select
                value={newTask.persona}
                onChange={(e) => setNewTask({ ...newTask, persona: e.target.value })}
              >
                <option value="">Unassigned</option>
                {personas.map(persona => (
                  <option key={persona.id} value={persona.id}>
                    {persona.emoji} {persona.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>AI Model</label>
              <select
                value={(newTask as any).model || ''}
                onChange={(e) => setNewTask({ ...newTask, model: e.target.value || undefined } as any)}
              >
                <option value="">Default (use persona/system default)</option>
                <option value="claude-sonnet-4-20250514">Sonnet (fast, cheap)</option>
                <option value="claude-opus-4-20250514">Opus (powerful, expensive)</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={newTask.tags.join(', ')}
                  onChange={(e) => setNewTask({ 
                    ...newTask, 
                    tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                  })}
                  placeholder="bug, feature, documentation"
                />
              </div>

              <div className="form-group">
                <label>Estimate</label>
                <input
                  type="text"
                  value={newTask.estimate}
                  onChange={(e) => setNewTask({ ...newTask, estimate: e.target.value })}
                  placeholder="2h, 1d, 1w"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Due Date</label>
              <input
                type="datetime-local"
                value={newTask.dueDate?.toISOString().slice(0, 16) || ''}
                onChange={(e) => setNewTask({ 
                  ...newTask, 
                  dueDate: e.target.value ? new Date(e.target.value) : undefined 
                })}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTaskModal;