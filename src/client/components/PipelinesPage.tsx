import React, { useState, useEffect } from 'react';
import { Pipeline } from '../types/pipeline';
import PipelineEditor from './PipelineEditor';

interface PipelineCardProps {
  pipeline: Pipeline;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

function PipelineCard({ pipeline, onEdit, onDelete, onToggleActive }: PipelineCardProps) {
  return (
    <div className={`pipeline-card ${pipeline.isActive ? 'active' : 'inactive'}`}>
      <div className="pipeline-header">
        <h3>{pipeline.name}</h3>
        <div className="pipeline-badge">
          {pipeline.stages.length} stage{pipeline.stages.length !== 1 ? 's' : ''}
        </div>
      </div>
      
      {pipeline.description && (
        <p className="pipeline-description">{pipeline.description}</p>
      )}
      
      <div className="pipeline-stages">
        {pipeline.stages.map((stage, index) => (
          <div key={stage.id} className="stage-chip">
            <span className="stage-number">{index + 1}</span>
            <span className="stage-name">{stage.name}</span>
            <span className="stage-persona">{stage.persona}</span>
            {stage.autoAdvance && <span className="auto-advance">⚡</span>}
          </div>
        ))}
      </div>
      
      <div className="pipeline-actions">
        <button onClick={onToggleActive} className="toggle-button">
          {pipeline.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={onEdit} className="edit-button">
          Edit
        </button>
        <button onClick={onDelete} className="delete-button">
          Delete
        </button>
      </div>
    </div>
  );
}

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);

  useEffect(() => {
    fetchPipelines();
  }, []);

  const fetchPipelines = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/pipelines');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch pipelines');
      }
      
      setPipelines(data.pipelines || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePipeline = () => {
    setEditingPipeline(null);
    setIsEditorOpen(true);
  };

  const handleEditPipeline = (pipeline: Pipeline) => {
    setEditingPipeline(pipeline);
    setIsEditorOpen(true);
  };

  const handleSavePipeline = async (pipelineData: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const url = editingPipeline ? `/api/pipelines/${editingPipeline.id}` : '/api/pipelines';
      const method = editingPipeline ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipelineData)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save pipeline');
      }
      
      await fetchPipelines(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDeletePipeline = async (pipelineId: string) => {
    if (!confirm('Are you sure you want to delete this pipeline?')) {
      return;
    }

    try {
      const response = await fetch(`/api/pipelines/${pipelineId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete pipeline');
      }
      
      await fetchPipelines(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleTogglePipelineActive = async (pipeline: Pipeline) => {
    try {
      const response = await fetch(`/api/pipelines/${pipeline.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !pipeline.isActive })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update pipeline');
      }
      
      await fetchPipelines(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (loading) {
    return (
      <div className="pipelines-page">
        <div className="loading">Loading pipelines...</div>
      </div>
    );
  }

  return (
    <div className="pipelines-page">
      <div className="page-header">
        <h1>📋 Pipelines</h1>
        <button onClick={handleCreatePipeline} className="create-button">
          + Create Pipeline
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="pipelines-stats">
        <div className="stat">
          <span className="stat-number">{pipelines.length}</span>
          <span className="stat-label">Total Pipelines</span>
        </div>
        <div className="stat">
          <span className="stat-number">{pipelines.filter(p => p.isActive).length}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat">
          <span className="stat-number">
            {pipelines.reduce((sum, p) => sum + p.stages.length, 0)}
          </span>
          <span className="stat-label">Total Stages</span>
        </div>
      </div>

      {pipelines.length === 0 ? (
        <div className="empty-state">
          <h3>No pipelines found</h3>
          <p>Create your first pipeline to automate task workflows between personas.</p>
          <button onClick={handleCreatePipeline} className="create-button">
            Create Your First Pipeline
          </button>
        </div>
      ) : (
        <div className="pipelines-grid">
          {pipelines.map(pipeline => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              onEdit={() => handleEditPipeline(pipeline)}
              onDelete={() => handleDeletePipeline(pipeline.id)}
              onToggleActive={() => handleTogglePipelineActive(pipeline)}
            />
          ))}
        </div>
      )}

      <PipelineEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        pipeline={editingPipeline}
        onSave={handleSavePipeline}
      />
    </div>
  );
}