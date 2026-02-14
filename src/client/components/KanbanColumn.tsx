import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Task, Persona } from '../types';
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
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  tasks,
  personas,
  onTaskClick,
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
          .map(task => (
            <TaskCard
              key={task.id}
              task={task}
              personas={personas}
              onClick={() => onTaskClick(task)}
            />
          ))}
      </div>
    </div>
  );
};

export default KanbanColumn;