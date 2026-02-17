import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKnowledge, deleteKnowledgeDoc } from '../hooks/useKnowledge.js';
import { KnowledgeMetadata } from '../types/index.js';

export function KnowledgePage() {
  const { docs, loading, error, refetch } = useKnowledge();
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    repo: '',
    area: '',
    topic: '',
    tags: ''
  });

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Are you sure you want to delete this knowledge doc?')) {
      return;
    }

    setDeletingId(id);
    const success = await deleteKnowledgeDoc(id);
    setDeletingId(null);

    if (success) {
      refetch(); // Refresh the list
    } else {
      alert('Failed to delete knowledge doc');
    }
  };

  const formatDate = (date: Date) => {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Use relative dates for recent items
    if (diffDays === 0) {
      return 'Today, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      // Nice format like "17 Feb 2026"
      return date.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
    }
  };

  const isStale = (doc: KnowledgeMetadata) => {
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

  // Apply filters
  const filteredDocs = docs.filter(doc => {
    if (filters.repo && !doc.repo?.toLowerCase().includes(filters.repo.toLowerCase())) {
      return false;
    }
    if (filters.area && doc.area !== filters.area) {
      return false;
    }
    if (filters.topic && !doc.topic.toLowerCase().includes(filters.topic.toLowerCase())) {
      return false;
    }
    if (filters.tags && !doc.tags.some(tag => 
      tag.toLowerCase().includes(filters.tags.toLowerCase())
    )) {
      return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="knowledge-page">
        <div className="page-header">
          <h1>🧠 Knowledge Base</h1>
          <p>AI-accessible documentation and reference materials</p>
        </div>
        <div className="loading">Loading knowledge docs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="knowledge-page">
        <div className="page-header">
          <h1>🧠 Knowledge Base</h1>
          <p>AI-accessible documentation and reference materials</p>
        </div>
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  const uniqueRepos = Array.from(new Set(docs.filter(d => d.repo).map(d => d.repo!))).sort();
  const uniqueAreas = Array.from(new Set(docs.map(d => d.area))).sort();

  return (
    <div className="knowledge-page">
      <div className="page-header">
        <h1>🧠 Knowledge Base</h1>
        <p>AI-accessible documentation and reference materials for the worker to use</p>
        <div className="actions">
          <button 
            className="btn btn-primary"
            onClick={() => navigate('/knowledge/new')}
          >
            + Add Knowledge
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <div className="filters">
          <input
            type="text"
            placeholder="Filter by repo..."
            value={filters.repo}
            onChange={(e) => setFilters(prev => ({ ...prev, repo: e.target.value }))}
            className="filter-input"
          />
          
          <select
            value={filters.area}
            onChange={(e) => setFilters(prev => ({ ...prev, area: e.target.value }))}
            className="filter-select"
          >
            <option value="">All areas</option>
            {uniqueAreas.map(area => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Filter by topic..."
            value={filters.topic}
            onChange={(e) => setFilters(prev => ({ ...prev, topic: e.target.value }))}
            className="filter-input"
          />

          <input
            type="text"
            placeholder="Filter by tags..."
            value={filters.tags}
            onChange={(e) => setFilters(prev => ({ ...prev, tags: e.target.value }))}
            className="filter-input"
          />

          {(filters.repo || filters.area || filters.topic || filters.tags) && (
            <button
              className="btn btn-secondary"
              onClick={() => setFilters({ repo: '', area: '', topic: '', tags: '' })}
            >
              Clear filters
            </button>
          )}
        </div>
        
        <div className="results-count">
          {filteredDocs.length} of {docs.length} docs
        </div>
      </div>

      {/* Knowledge docs list */}
      <div className="knowledge-list">
        {filteredDocs.length === 0 ? (
          <div className="empty-state">
            <p>No knowledge docs found.</p>
            <button 
              className="btn btn-primary"
              onClick={() => navigate('/knowledge/new')}
            >
              Create your first knowledge doc
            </button>
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <div key={doc.id} className="knowledge-card">
              <div className="knowledge-header">
                <div className="title-section">
                  <h3 
                    className="knowledge-title"
                    onClick={() => navigate(`/knowledge/${doc.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    {doc.title}
                    {isStale(doc) && <span className="stale-indicator">⚠️ Stale</span>}
                  </h3>
                  <div className="knowledge-meta">
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
                
                <div className="knowledge-actions">
                  <button
                    className="btn-icon"
                    onClick={() => navigate(`/knowledge/${doc.id}/edit`)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => handleDeleteDoc(doc.id)}
                    disabled={deletingId === doc.id}
                    title="Delete"
                  >
                    {deletingId === doc.id ? '⏳' : '🗑️'}
                  </button>
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

              <div className="knowledge-footer">
                <span className="date">
                  Updated {formatDate(doc.updatedAt)}
                </span>
                {doc.lastVerified && (
                  <span className="verified">
                    Verified {formatDate(doc.lastVerified)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}