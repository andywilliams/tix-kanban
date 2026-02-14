import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Task, Persona } from '../types';

interface TaskCardProps {
  task: Task;
  personas: Persona[];
  onClick: () => void;
  isDragging?: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, personas, onClick, isDragging }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingFromKit,
  } = useDraggable({
    id: task.id,
  });

  const persona = personas.find(p => p.id === task.persona);
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const priorityColor = getPriorityColor(task.priority);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`task-card ${isDragging || isDraggingFromKit ? 'dragging' : ''}`}
      onClick={onClick}
    >
      <div className="task-header">
        <div className="task-priority" style={{ backgroundColor: priorityColor }}>
          {task.priority}
        </div>
        {persona && (
          <div className="task-persona" title={persona.name}>
            {persona.emoji}
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
        
        {task.assignee && (
          <div className="task-assignee" title={task.assignee}>
            {getInitials(task.assignee)}
          </div>
        )}
      </div>
    </div>
  );
};

function getPriorityColor(priority: number): string {
  if (priority >= 150) return '#ef4444'; // red
  if (priority >= 100) return '#f59e0b'; // amber
  if (priority >= 50) return '#10b981'; // emerald
  return '#6b7280'; // gray
}

function getInitials(email: string): string {
  const name = email.split('@')[0];
  return name
    .split(/[.\-_]/)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export default TaskCard;