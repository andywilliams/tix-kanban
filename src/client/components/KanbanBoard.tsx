import React, { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Task, Persona, Filter } from '../types';
import KanbanColumn from './KanbanColumn';
import TaskCard from './TaskCard';
import TaskModal from './TaskModal';
import CreateTaskModal from './CreateTaskModal';
import FilterBar from './FilterBar';

interface KanbanBoardProps {
  tasks: Task[];
  personas: Persona[];
  currentUser: string;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onAddTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const columns = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
] as const;

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  personas,
  currentUser,
  onUpdateTask,
  onAddTask,
}) => {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<Filter>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) {
      setActiveTask(null);
      return;
    }

    const task = tasks.find(t => t.id === active.id);
    const newStatus = over.id as Task['status'];
    
    if (task && task.status !== newStatus) {
      onUpdateTask(task.id, { status: newStatus });
    }
    
    setActiveTask(null);
  };

  const filteredTasks = tasks.filter(task => {
    if (filter.assignee && task.assignee !== filter.assignee) return false;
    if (filter.persona && task.persona !== filter.persona) return false;
    if (filter.status && task.status !== filter.status) return false;
    if (filter.tags?.length && !filter.tags.some(tag => task.tags.includes(tag))) return false;
    return true;
  });

  return (
    <div className="kanban-board">
      <FilterBar
        tasks={tasks}
        personas={personas}
        filter={filter}
        onFilterChange={setFilter}
        onCreateTask={() => setShowCreateModal(true)}
      />
      
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-columns">
          {columns.map(column => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={filteredTasks.filter(task => task.status === column.id)}
              personas={personas}
              onTaskClick={setSelectedTask}
            />
          ))}
        </div>
        
        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              personas={personas}
              onClick={() => {}}
              isDragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          personas={personas}
          currentUser={currentUser}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updates) => {
            onUpdateTask(selectedTask.id, updates);
            setSelectedTask({ ...selectedTask, ...updates });
          }}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal
          personas={personas}
          onClose={() => setShowCreateModal(false)}
          onSubmit={(task) => {
            onAddTask(task);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
};

export default KanbanBoard;