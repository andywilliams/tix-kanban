import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useKnowledgeDoc, deleteKnowledgeDoc, saveKnowledgeDoc } from '../hooks/useKnowledge.js';
import { KnowledgeDoc } from '../types/index.js';

export function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { doc, loading, error } = useKnowledgeDoc(id);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string;
    content: string;
    description: string;
    repo: string;
    area: 'frontend' | 'backend' | 'API' | 'infra' | 'general';
    topic: string;
    tags: string;
  }>({
    title: '',
    content: '',
    description: '',
    repo: '',
    area: 'general',
    topic: '',
    tags: ''
  });

  React.useEffect(() => {
    if (doc && !isEditing) {
      setEditForm({
        title: doc.title,
        content: doc.content,
        description: doc.description || '',
        repo: doc.repo || '',
        area: doc.area,
        topic: doc.topic,
        tags: doc.tags.join(', ')
      });
    }
  }, [doc, isEditing]);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (doc) {
      setEditForm({
        title: doc.title,
        content: doc.content,
        description: doc.description || '',
        repo: doc.repo || '',
        area: doc.area,
        topic: doc.topic,
        tags: doc.tags.join(', ')
      });
    }
  };

  const handleSave = async () => {
    if (!doc || !editForm.title.trim() || !editForm.content.trim() || !editForm.topic.trim()) {
      alert('Title, content, and topic are required');
      return;
    }

    const tags = editForm.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

    const saved = await saveKnowledgeDoc(editForm.title, editForm.content, {
      description: editForm.description,
      repo: editForm.repo || undefined,
      area: editForm.area,
      topic: editForm.topic,
      tags,
      id: doc.id
    });

    if (saved) {
      setIsEditing(false);
      // Refresh the page to show updated content
      window.location.reload();
    } else {
      alert('Failed to save knowledge doc');
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    
    if (!confirm(`Are you sure you want to delete "${doc.title}"? This cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    const success = await deleteKnowledgeDoc(doc.id);
    
    if (success) {
      navigate('/knowledge');
    } else {
      alert('Failed to delete knowledge doc');
      setIsDeleting(false);
    }
  };

  const formatDate = (date: Date) => {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    
    return date.toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isStale = (doc: KnowledgeDoc) => {
    if (!doc.lastVerified) return true;
    const now = new Date();
    const lastVerified = new Date(doc.lastVerified);
    const daysDiff = Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff > 30; // Consider stale if not verified in 30+ days
  };

  const getAreaColor = (area: string) => {
    switch (area) {
      case 'frontend': return '#3b82f6'; // blue
      case 'backend': return '#10b981'; // green
      case 'API': return '#f59e0b'; // amber
      case 'infra': return '#8b5cf6'; // purple
      case 'general': return '#6b7280'; // gray
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="knowledge-detail">
        <div className="loading">Loading knowledge doc...</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="knowledge-detail">
        <div className="error">
          {error || 'Knowledge doc not found'}
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/knowledge')}>
          ← Back to Knowledge Base
        </button>
      </div>
    );
  }

  return (
    <div className="knowledge-detail">
      <div className="knowledge-header">
        <button className="btn btn-secondary" onClick={() => navigate('/knowledge')}>
          ← Back to Knowledge Base
        </button>
        
        <div className="actions">
          {!isEditing ? (
            <>
              <button className="btn btn-primary" onClick={handleEdit}>
                ✏️ Edit
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? '⏳' : '🗑️'} Delete
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleCancelEdit}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      {!isEditing ? (
        /* View Mode */
        <div className="knowledge-view">
          <div className="knowledge-meta-header">
            <h1 className="knowledge-title">
              {doc.title}
              {isStale(doc) && <span className="stale-indicator">⚠️ Stale</span>}
            </h1>
            
            <div className="knowledge-badges">
              <span 
                className="area-badge" 
                style={{ backgroundColor: getAreaColor(doc.area), color: 'white' }}
              >
                {doc.area}
              </span>
              {doc.repo && <span className="repo-badge">{doc.repo}</span>}
              <span className="topic-badge">{doc.topic}</span>
            </div>
          </div>

          {doc.description && (
            <p className="knowledge-description">{doc.description}</p>
          )}

          {doc.tags.length > 0 && (
            <div className="tags">
              {doc.tags.map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
            </div>
          )}

          <div className="knowledge-dates">
            <span>Created: {formatDate(doc.createdAt)}</span>
            <span>Updated: {formatDate(doc.updatedAt)}</span>
            {doc.lastVerified && (
              <span>Last verified: {formatDate(doc.lastVerified)}</span>
            )}
          </div>

          <div className="knowledge-content">
            <pre className="markdown-content">{doc.content}</pre>
          </div>
        </div>
      ) : (
        /* Edit Mode */
        <div className="knowledge-edit">
          <div className="form-group">
            <label htmlFor="title">Title *</label>
            <input
              id="title"
              type="text"
              value={editForm.title}
              onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <input
              id="description"
              type="text"
              value={editForm.description}
              onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
              className="form-input"
              placeholder="Brief summary of what this knowledge doc covers"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="repo">Repository</label>
              <input
                id="repo"
                type="text"
                value={editForm.repo}
                onChange={(e) => setEditForm(prev => ({ ...prev, repo: e.target.value }))}
                className="form-input"
                placeholder="owner/repo (optional)"
              />
            </div>

            <div className="form-group">
              <label htmlFor="area">Area *</label>
              <select
                id="area"
                value={editForm.area}
                onChange={(e) => setEditForm(prev => ({ ...prev, area: e.target.value as any }))}
                className="form-select"
                required
              >
                <option value="general">General</option>
                <option value="frontend">Frontend</option>
                <option value="backend">Backend</option>
                <option value="API">API</option>
                <option value="infra">Infrastructure</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="topic">Topic *</label>
              <input
                id="topic"
                type="text"
                value={editForm.topic}
                onChange={(e) => setEditForm(prev => ({ ...prev, topic: e.target.value }))}
                className="form-input"
                placeholder="e.g. authentication, database, deployment"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              type="text"
              value={editForm.tags}
              onChange={(e) => setEditForm(prev => ({ ...prev, tags: e.target.value }))}
              className="form-input"
              placeholder="Comma-separated tags for search"
            />
          </div>

          <div className="form-group">
            <label htmlFor="content">Content *</label>
            <textarea
              id="content"
              value={editForm.content}
              onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
              className="form-textarea"
              rows={20}
              placeholder="Write your knowledge doc content in markdown..."
              required
            />
          </div>
        </div>
      )}
    </div>
  );
}