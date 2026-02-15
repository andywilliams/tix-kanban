import React, { useState, useEffect } from 'react';
import { Task, Persona, GitHubConfig } from '../types';
import { GitHubStatus } from './GitHubStatus';

interface TaskModalProps {
  task: Task;
  personas: Persona[];
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => void;
}

interface CommentFormData {
  body: string;
  author: string;
}

interface LinkFormData {
  url: string;
  title: string;
  type: 'pr' | 'attachment' | 'reference';
}

const TaskModal: React.FC<TaskModalProps> = ({ task, personas, onClose, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [editedTask, setEditedTask] = useState(task);
  const [githubConfig, setGithubConfig] = useState<GitHubConfig | null>(null);
  const [creatingPR, setCreatingPR] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState('');
  
  // Comment form state
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentForm, setCommentForm] = useState<CommentFormData>({ body: '', author: 'User' });
  const [addingComment, setAddingComment] = useState(false);
  
  // Link form state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState<LinkFormData>({ url: '', title: '', type: 'reference' });
  const [addingLink, setAddingLink] = useState(false);

  useEffect(() => {
    loadGitHubConfig();
  }, []);

  const loadGitHubConfig = async () => {
    try {
      const response = await fetch('/api/github/config');
      if (response.ok) {
        const data = await response.json();
        setGithubConfig(data.config);
        if (data.config.repos.length > 0) {
          setSelectedRepo(task.repo || data.config.repos[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load GitHub config:', error);
    }
  };

  const createPR = async () => {
    if (!selectedRepo) return;
    
    setCreatingPR(true);
    try {
      const response = await fetch('/api/github/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: selectedRepo,
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        // Update task with repo info
        onUpdate({ ...task, repo: selectedRepo });
        alert(`PR created successfully: ${data.prStatus.url}`);
      } else {
        const error = await response.json();
        alert(`Failed to create PR: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error('Failed to create PR:', error);
      alert('Failed to create PR. Check console for details.');
    } finally {
      setCreatingPR(false);
    }
  };

  const addComment = async () => {
    if (!commentForm.body.trim()) return;
    
    setAddingComment(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commentForm),
      });
      
      if (response.ok) {
        const data = await response.json();
        onUpdate(data.task);
        setCommentForm({ body: '', author: 'User' });
        setShowCommentForm(false);
      } else {
        const error = await response.json();
        alert(`Failed to add comment: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment. Check console for details.');
    } finally {
      setAddingComment(false);
    }
  };

  const addLink = async () => {
    if (!linkForm.url.trim() || !linkForm.title.trim()) return;
    
    setAddingLink(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkForm),
      });
      
      if (response.ok) {
        const data = await response.json();
        onUpdate(data.task);
        setLinkForm({ url: '', title: '', type: 'reference' });
        setShowLinkForm(false);
      } else {
        const error = await response.json();
        alert(`Failed to add link: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to add link:', error);
      alert('Failed to add link. Check console for details.');
    } finally {
      setAddingLink(false);
    }
  };

  const deleteLink = async (linkId: string) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/links/${linkId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        const data = await response.json();
        onUpdate(data.task);
      } else {
        const error = await response.json();
        alert(`Failed to delete link: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to delete link:', error);
      alert('Failed to delete link. Check console for details.');
    }
  };

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

              <div className="form-group">
                <label>GitHub Repository</label>
                <select
                  value={editedTask.repo || ''}
                  onChange={(e) => setEditedTask({ 
                    ...editedTask, 
                    repo: e.target.value || undefined 
                  })}
                >
                  <option value="">None</option>
                  {githubConfig?.repos.map(repo => (
                    <option key={repo} value={repo}>
                      {repo}
                    </option>
                  ))}
                </select>
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
                {task.repo && <p><strong>Repository:</strong> {task.repo}</p>}
              </div>

              {/* Comments Section */}
              <div className="comments-section">
                <div className="section-header">
                  <h4>Comments ({task.comments?.length || 0})</h4>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowCommentForm(!showCommentForm)}
                  >
                    Add Comment
                  </button>
                </div>
                
                {showCommentForm && (
                  <div className="comment-form">
                    <div className="form-row">
                      <input
                        type="text"
                        placeholder="Your name"
                        value={commentForm.author}
                        onChange={(e) => setCommentForm({ ...commentForm, author: e.target.value })}
                        style={{ width: '150px', marginRight: '10px' }}
                      />
                    </div>
                    <textarea
                      placeholder="Add a comment..."
                      value={commentForm.body}
                      onChange={(e) => setCommentForm({ ...commentForm, body: e.target.value })}
                      rows={3}
                      style={{ width: '100%', marginBottom: '10px' }}
                    />
                    <div className="form-actions">
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowCommentForm(false)}
                      >
                        Cancel
                      </button>
                      <button 
                        className="btn btn-primary btn-sm"
                        onClick={addComment}
                        disabled={addingComment || !commentForm.body.trim()}
                      >
                        {addingComment ? 'Adding...' : 'Add Comment'}
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="comments-list">
                  {task.comments?.map(comment => (
                    <div key={comment.id} className="comment">
                      <div className="comment-header">
                        <strong>{comment.author}</strong>
                        <span className="comment-date">{comment.createdAt.toLocaleString()}</span>
                      </div>
                      <div className="comment-body">{comment.body}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Links Section */}
              <div className="links-section">
                <div className="section-header">
                  <h4>Links ({task.links?.length || 0})</h4>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowLinkForm(!showLinkForm)}
                  >
                    Add Link
                  </button>
                </div>
                
                {showLinkForm && (
                  <div className="link-form">
                    <input
                      type="text"
                      placeholder="URL"
                      value={linkForm.url}
                      onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })}
                      style={{ width: '100%', marginBottom: '10px' }}
                    />
                    <input
                      type="text"
                      placeholder="Title"
                      value={linkForm.title}
                      onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })}
                      style={{ width: '100%', marginBottom: '10px' }}
                    />
                    <select
                      value={linkForm.type}
                      onChange={(e) => setLinkForm({ ...linkForm, type: e.target.value as 'pr' | 'attachment' | 'reference' })}
                      style={{ width: '100%', marginBottom: '10px' }}
                    >
                      <option value="reference">Reference</option>
                      <option value="pr">Pull Request</option>
                      <option value="attachment">Attachment</option>
                    </select>
                    <div className="form-actions">
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowLinkForm(false)}
                      >
                        Cancel
                      </button>
                      <button 
                        className="btn btn-primary btn-sm"
                        onClick={addLink}
                        disabled={addingLink || !linkForm.url.trim() || !linkForm.title.trim()}
                      >
                        {addingLink ? 'Adding...' : 'Add Link'}
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="links-list">
                  {task.links?.map(link => (
                    <div key={link.id} className="link-item">
                      <div className="link-info">
                        <a href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.title}
                        </a>
                        <span className="link-type">{link.type}</span>
                      </div>
                      <button 
                        className="btn btn-danger btn-sm"
                        onClick={() => deleteLink(link.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* GitHub Section */}
              {githubConfig && githubConfig.repos.length > 0 && (
                <div className="github-section">
                  <h4>GitHub Integration</h4>
                  
                  <GitHubStatus taskId={task.id} repo={task.repo} />
                  
                  <div className="github-actions">
                    <div className="create-pr-section">
                      <label htmlFor="repo-select">Create PR in:</label>
                      <select
                        id="repo-select"
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                      >
                        <option value="">Select repository...</option>
                        {githubConfig.repos.map(repo => (
                          <option key={repo} value={repo}>
                            {repo}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-secondary"
                        onClick={createPR}
                        disabled={!selectedRepo || creatingPR}
                      >
                        {creatingPR ? 'Creating...' : 'Create PR'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
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