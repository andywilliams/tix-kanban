import React, { useState } from 'react';
import { Task, Persona } from '../types';

interface TaskModalProps {
  task: Task;
  personas: Persona[];
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => void;
}

const TaskModal: React.FC<TaskModalProps> = ({ task, personas, onClose, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [editedTask, setEditedTask] = useState(task);

  const handleSave = () => {
    onUpdate(editedTask);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditedTask(task);
    setEditing(false);
  };

  const persona = personas.find(p => p.id === task.persona);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editing ? 'Edit Task' : 'Task Details'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {editing ? (
            <>
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={editedTask.title}
                  onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={editedTask.description}
                  onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                  rows={4}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={editedTask.status}
                    onChange={(e) => setEditedTask({ 
                      ...editedTask, 
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
                    value={editedTask.priority}
                    onChange={(e) => setEditedTask({ 
                      ...editedTask, 
                      priority: parseInt(e.target.value) || 0 
                    })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Assigned Persona</label>
                <select
                  value={editedTask.persona || ''}
                  onChange={(e) => setEditedTask({ 
                    ...editedTask, 
                    persona: e.target.value || undefined 
                  })}
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
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={editedTask.tags.join(', ')}
                  onChange={(e) => setEditedTask({ 
                    ...editedTask, 
                    tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                  })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="task-detail-header">
                <div className="task-meta">
                  <span className="task-id">#{task.id}</span>
                  <span className="task-status">{task.status}</span>
                  <span className="task-priority">Priority: {task.priority}</span>
                </div>
                {persona && (
                  <div className="task-assignee-badge">
                    <span className="persona-emoji">{persona.emoji}</span>
                    <span className="persona-name">Assigned to {persona.name}</span>
                  </div>
                )}
              </div>

              <h3>{task.title}</h3>
              
              {task.description && (
                <div className="task-description">
                  <pre>{task.description}</pre>
                </div>
              )}

              {task.tags.length > 0 && (
                <div className="task-tags">
                  {task.tags.map(tag => (
                    <span key={tag} className="task-tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="task-metadata">
                <p><strong>Created:</strong> {task.createdAt.toLocaleString()}</p>
                <p><strong>Updated:</strong> {task.updatedAt.toLocaleString()}</p>
                {task.dueDate && <p><strong>Due:</strong> {task.dueDate.toLocaleString()}</p>}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {editing ? (
            <>
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Save Changes
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Edit Task
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskModal;