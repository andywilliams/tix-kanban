import React, { useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Task, Persona } from '../types';
import { Pipeline, TaskPipelineState } from '../types/pipeline';

interface TaskCardProps {
  task: Task;
  personas: Persona[];
  onClick: () => void;
  isDragging?: boolean;
  pipeline?: Pipeline | null;
  pipelineState?: TaskPipelineState | null;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, personas, onClick, isDragging, pipeline: propPipeline, pipelineState: propPipelineState }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingFromKit,
  } = useDraggable({
    id: task.id,
  });

  // Use passed props if available, otherwise use local state
  const [localPipeline, setLocalPipeline] = useState<Pipeline | null>(null);
  const [localPipelineState, setLocalPipelineState] = useState<TaskPipelineState | null>(null);

  // Use prop if provided, otherwise use local state
  const pipeline = propPipeline !== undefined ? propPipeline : localPipeline;
  const pipelineStateVal = propPipelineState !== undefined ? propPipelineState : localPipelineState;

  // Track previous pipelineId to detect changes
  const prevPipelineIdRef = React.useRef<string | null | undefined>(task.pipelineId);

  // Detect when pipelineId changes and refetch if needed
  useEffect(() => {
    const prevPipelineId = prevPipelineIdRef.current;
    if (task.pipelineId !== prevPipelineId) {
      prevPipelineIdRef.current = task.pipelineId;
      
      if (task.pipelineId) {
        // Pipeline changed - fetch fresh data if no prop provided OR if propPipelineState is missing
        if (propPipeline === undefined || propPipelineState === undefined) {
          loadPipelineInfo();
        }
      } else {
        // Pipeline was cleared
        setLocalPipeline(null);
        setLocalPipelineState(null);
      }
    }
  }, [task.pipelineId, propPipeline, propPipelineState]);

  const loadPipelineInfo = async () => {
    if (!task.pipelineId) return;
    
    try {
      const [pipelineRes, stateRes] = await Promise.all([
        fetch(`/api/pipelines/${task.pipelineId}`),
        fetch(`/api/tasks/${task.id}/pipeline-state`)
      ]);
      
      if (pipelineRes.ok) {
        const data = await pipelineRes.json();
        setLocalPipeline(data.pipeline);
      }
      
      if (stateRes.ok) {
        const data = await stateRes.json();
        setLocalPipelineState(data.state);
      }
    } catch (error) {
      console.error('Failed to load pipeline info:', error);
    }
  };

  const persona = personas.find(p => p.id === task.persona);
  const isAgentWorking = task.agentActivity?.status === 'working';
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const priorityColor = getPriorityColor(task.priority);
  const currentStage = pipeline && pipelineStateVal 
    ? pipeline.stages.find(s => s.id === pipelineStateVal.currentStageId)
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`task-card ${isDragging || isDraggingFromKit ? 'dragging' : ''}${isAgentWorking ? ' agent-working' : ''}`}
      onClick={onClick}
    >
      <div className="task-header">
        <div className="task-priority" style={{ backgroundColor: priorityColor }}>
          {task.priority}
        </div>
        {persona && (
          <div className={`task-assignee${isAgentWorking ? ' agent-active' : ''}`} title={isAgentWorking ? `${persona.name} is working on this...` : `Assigned to ${persona.name}`}>
            {persona.emoji}
            {isAgentWorking && <span className="agent-pulse" />}
          </div>
        )}
      </div>
      
      <h4 className="task-title">{task.title}</h4>
      
      {task.description && (
        <p className="task-description">
          {task.description.slice(0, 100)}
          {task.description.length > 100 ? '...' : ''}
        </p>
      )}
      
      <div className="task-footer">
        <div className="task-tags">
          {task.tags.slice(0, 3).map(tag => (
            <span key={tag} className="task-tag">
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="task-tag-more">+{task.tags.length - 3}</span>
          )}
        </div>
        <div className="task-status-icons">
          {task.holdForMerge && (
            <span className="hold-merge-indicator" title="Held for manual merge">🔒</span>
          )}
          {task.links && task.links.some(l => l.type === 'pr') && (
            <span className="github-status compact" title="Has linked PR">🔗</span>
          )}
        </div>
      </div>
      
      {pipeline && currentStage && (
        <div className="task-pipeline-info">
          <span className="pipeline-name">{pipeline.name}</span>
          <span className="pipeline-separator"> › </span>
          <span className="pipeline-stage">{currentStage.name}</span>
        </div>
      )}
    </div>
  );
};

function getPriorityColor(priority: number): string {
  if (priority >= 150) return '#ef4444'; // red
  if (priority >= 100) return '#f59e0b'; // amber
  if (priority >= 50) return '#10b981'; // emerald
  return '#6b7280'; // gray
}

export default TaskCard;