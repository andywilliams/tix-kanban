import React from 'react';
import { Task } from '../../types';

interface BoardSummaryProps {
  tasks: Task[];
  compact?: boolean;
}

export default function BoardSummary({ tasks, compact = false }: BoardSummaryProps) {
  const grouped = {
    backlog: tasks.filter(t => t.status === 'backlog'),
    'in-progress': tasks.filter(t => t.status === 'in-progress'),
    'auto-review': tasks.filter(t => t.status === 'auto-review'),
    review: tasks.filter(t => t.status === 'review'),
    done: tasks.filter(t => t.status === 'done'),
  };

  const statusColors: Record<string, string> = {
    backlog: '#6b7280',
    'in-progress': '#3b82f6',
    'auto-review': '#8b5cf6',
    review: '#eab308',
    done: '#22c55e',
  };

  const statusEmojis: Record<string, string> = {
    backlog: '📝',
    'in-progress': '🔨',
    'auto-review': '🤖',
    review: '👀',
    done: '✅',
  };

  if (compact) {
    return (
      <div style={{
        display: 'inline-flex',
        gap: '0.75rem',
        padding: '0.5rem 0.75rem',
        background: 'var(--bg-tertiary)',
        borderRadius: '0.5rem',
        border: '1px solid var(--border)',
        fontSize: '0.85rem'
      }}>
        {Object.entries(grouped).map(([status, statusTasks]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span>{statusEmojis[status]}</span>
            <span style={{ 
              fontWeight: 600, 
              color: statusColors[status],
              fontSize: '0.9rem'
            }}>
              {statusTasks.length}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      borderRadius: '0.75rem',
      padding: '1rem',
      marginTop: '0.5rem'
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '0.5rem', 
        marginBottom: '0.75rem',
        paddingBottom: '0.5rem',
        borderBottom: '1px solid var(--border)'
      }}>
        <span style={{ fontSize: '1.2rem' }}>📊</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Board Summary</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {Object.entries(grouped).map(([status, statusTasks]) => {
          const label = status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          return (
            <div key={status} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              background: 'var(--bg-primary)',
              borderRadius: '0.5rem',
              border: `1px solid ${statusColors[status]}40`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>{statusEmojis[status]}</span>
                <span style={{ 
                  fontSize: '0.85rem', 
                  color: 'var(--text-secondary)',
                  fontWeight: 500
                }}>
                  {label}
                </span>
              </div>
              <div style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                background: `${statusColors[status]}20`,
                color: statusColors[status],
                fontSize: '0.8rem',
                fontWeight: 600
              }}>
                {statusTasks.length}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border)',
        fontSize: '0.85rem',
        color: 'var(--text-muted)',
        textAlign: 'center'
      }}>
        Total: {tasks.length} tasks
      </div>
    </div>
  );
}
