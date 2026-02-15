import React from 'react';
import { Persona } from '../types/index';

interface PersonaCardProps {
  persona: Persona;
  onEdit: () => void;
  onDelete: () => void;
}

export function PersonaCard({ persona, onEdit, onDelete }: PersonaCardProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatCompletionTime = (minutes: number) => {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{persona.emoji}</span>
            <div>
              <h3 className="text-lg font-semibold text-gray-800">{persona.name}</h3>
              <p className="text-sm text-gray-500">ID: {persona.id}</p>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-blue-600 transition-colors duration-200"
              title="Edit persona"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1 text-gray-400 hover:text-red-600 transition-colors duration-200"
              title="Delete persona"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <p className="text-gray-600 text-sm mb-4 line-clamp-2">
          {persona.description}
        </p>

        {/* Specialties */}
        {persona.specialties.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-1">
              {persona.specialties.slice(0, 3).map((specialty) => (
                <span
                  key={specialty}
                  className="inline-block px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-full"
                >
                  {specialty}
                </span>
              ))}
              {persona.specialties.length > 3 && (
                <span className="inline-block px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-full">
                  +{persona.specialties.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 pt-4 border-t border-gray-100">
          <div className="text-center">
            <div className="text-sm font-medium text-gray-800">
              {persona.stats.tasksCompleted}
            </div>
            <div className="text-xs text-gray-500">Tasks</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-gray-800">
              {persona.stats.tasksCompleted > 0 
                ? formatCompletionTime(persona.stats.averageCompletionTime)
                : '-'
              }
            </div>
            <div className="text-xs text-gray-500">Avg Time</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-gray-800">
              {persona.stats.tasksCompleted > 0 
                ? `${Math.round(persona.stats.successRate)}%`
                : '-'
              }
            </div>
            <div className="text-xs text-gray-500">Success</div>
          </div>
        </div>

        {/* Last active */}
        {persona.stats.lastActiveAt && (
          <div className="text-xs text-gray-500 text-center mt-2">
            Last active: {formatDate(persona.stats.lastActiveAt)}
          </div>
        )}

        {/* Created date */}
        <div className="text-xs text-gray-400 text-center mt-1">
          Created: {formatDate(persona.createdAt)}
        </div>
      </div>
    </div>
  );
}