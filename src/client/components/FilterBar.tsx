import React from 'react';
import { Task, Persona, Filter } from '../types';

interface FilterBarProps {
  tasks: Task[];
  personas: Persona[];
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onCreateTask: () => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  tasks,
  personas,
  filter,
  onFilterChange,
  onCreateTask,
}) => {
  const uniqueAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  const uniqueTags = Array.from(new Set(tasks.flatMap(t => t.tags)));

  return (
    <div className="filter-bar">
      <div className="filter-controls">
        <select
          value={filter.assignee || ''}
          onChange={(e) => onFilterChange({ ...filter, assignee: e.target.value || undefined })}
        >
          <option value="">All Assignees</option>
          {uniqueAssignees.map(assignee => (
            <option key={assignee} value={assignee}>{assignee}</option>
          ))}
        </select>

        <select
          value={filter.persona || ''}
          onChange={(e) => onFilterChange({ ...filter, persona: e.target.value || undefined })}
        >
          <option value="">All Personas</option>
          {personas.map(persona => (
            <option key={persona.id} value={persona.id}>
              {persona.emoji} {persona.name}
            </option>
          ))}
        </select>

        <select
          value={filter.status || ''}
          onChange={(e) => onFilterChange({ ...filter, status: e.target.value as Task['status'] || undefined })}
        >
          <option value="">All Statuses</option>
          <option value="backlog">Backlog</option>
          <option value="in-progress">In Progress</option>
          <option value="review">Review</option>
          <option value="done">Done</option>
        </select>

        <select
          value={filter.tags?.[0] || ''}
          onChange={(e) => onFilterChange({ 
            ...filter, 
            tags: e.target.value ? [e.target.value] : undefined 
          })}
        >
          <option value="">All Tags</option>
          {uniqueTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>

        {(filter.assignee || filter.persona || filter.status || filter.tags) && (
          <button
            className="clear-filters"
            onClick={() => onFilterChange({})}
          >
            Clear Filters
          </button>
        )}
      </div>

      <button className="create-task-btn" onClick={onCreateTask}>
        + Create Task
      </button>
    </div>
  );
};

export default FilterBar;