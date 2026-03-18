import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Task, Persona } from '../types';
import { Pipeline, TaskPipelineState } from '../types/pipeline';
import TaskCard from './TaskCard';

interface Column {
  id: string;
  title: string;
}

interface KanbanColumnProps {
  column: Column;
  tasks: Task[];
  personas: Persona[];
  onTaskClick: (task: Task) => void;
  pipelines?: Pipeline[];
  pipelineStates?: Record<string, TaskPipelineState>;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  tasks,
  personas,
  onTaskClick,
  pipelines = [],
  pipelineStates = {},
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'drag-over' : ''}`}
    >
      <div className="column-header">
        <h3>{column.title}</h3>
        <span className="task-count">{tasks.length}</span>
      </div>
      
      <div className="column-content">
        {tasks
          .sort((a, b) => b.priority - a.priority)
          .map(task => {
            const pipeline = task.pipelineId ? pipelines.find(p => p.id === task.pipelineId) : undefined;
            const pipelineState = task.pipelineId ? pipelineStates[task.id] : undefined;
            return (
              <TaskCard
                key={task.id}
                task={task}
                personas={personas}
                onClick={() => onTaskClick(task)}
                pipeline={pipeline}
                pipelineState={pipelineState}
              />
            );
          })}
      </div>
    </div>
  );
};

export default KanbanColumn;