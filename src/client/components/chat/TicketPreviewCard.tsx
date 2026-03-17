import React from 'react';

interface TicketPreview {
  title: string;
  description: string;
  priority: number;
  assignee?: string;
  tags?: string[];
}

interface TicketPreviewCardProps {
  ticket: TicketPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

const priorityLabels: Record<number, { label: string; color: string }> = {
  100: { label: 'Critical', color: '#ef4444' },
  200: { label: 'High', color: '#f97316' },
  300: { label: 'Medium', color: '#eab308' },
  400: { label: 'Normal', color: '#3b82f6' },
  500: { label: 'Low', color: '#6b7280' },
};

export default function TicketPreviewCard({ ticket, onConfirm, onCancel }: TicketPreviewCardProps) {
  const priorityInfo = priorityLabels[ticket.priority] || priorityLabels[400];

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '2px solid var(--accent)',
      borderRadius: '0.75rem',
      padding: '1rem',
      marginTop: '0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>📋</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
          Confirm Ticket Creation
        </span>
      </div>

      <div style={{ 
        background: 'var(--bg-primary)', 
        border: '1px solid var(--border)',
        borderRadius: '0.5rem', 
        padding: '0.75rem',
        marginBottom: '0.75rem'
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          {ticket.title}
        </div>
        
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: '1.5' }}>
          {ticket.description.length > 200 
            ? ticket.description.substring(0, 200) + '...'
            : ticket.description
          }
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            background: `${priorityInfo.color}20`,
            color: priorityInfo.color,
            border: `1px solid ${priorityInfo.color}40`
          }}>
            {priorityInfo.label}
          </span>

          {ticket.assignee && (
            <span style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)'
            }}>
              👤 {ticket.assignee}
            </span>
          )}

          {ticket.tags && ticket.tags.length > 0 && (
            <>
              {ticket.tags.map((tag, idx) => (
                <span key={idx} style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  background: 'rgba(139, 92, 246, 0.15)',
                  color: '#8b5cf6',
                  border: '1px solid rgba(139, 92, 246, 0.3)'
                }}>
                  {tag}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-primary)';
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: 'var(--accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-hover)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          ✓ Create Ticket
        </button>
      </div>
    </div>
  );
}
