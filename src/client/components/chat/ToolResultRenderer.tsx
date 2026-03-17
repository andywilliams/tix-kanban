import React from 'react';
import { Persona } from '../../types';

interface ToolResultRendererProps {
  content: string;
  personas: Persona[];
}

export default function ToolResultRenderer({ content, personas }: ToolResultRendererProps) {
  // Task creation result
  const taskCreatedMatch = content.match(/📋 \*\*Ticket created:\*\* (.+?) \(ID: ([A-Za-z0-9]+)\)(.*)/);
  if (taskCreatedMatch) {
    const [, title, taskId, rest] = taskCreatedMatch;
    return (
      <div style={{
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📋</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Ticket Created</span>
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{title}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            ID: <code style={{ background: 'var(--bg-primary)', padding: '0.1rem 0.3rem', borderRadius: '0.2rem' }}>{taskId}</code>
            {rest}
          </div>
        </div>
      </div>
    );
  }

  // Task updated result
  const taskUpdatedMatch = content.match(/📝 \*\*Task updated:\*\* ([A-Za-z0-9]+) - (.+)/);
  if (taskUpdatedMatch) {
    const [, taskId, changes] = taskUpdatedMatch;
    return (
      <div style={{
        background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📝</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Task Updated</span>
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            ID: <code style={{ background: 'var(--bg-primary)', padding: '0.1rem 0.3rem', borderRadius: '0.2rem' }}>{taskId}</code>
          </div>
          <div>{changes}</div>
        </div>
      </div>
    );
  }

  // Reminder set result
  const reminderMatch = content.match(/⏰ \*\*Reminder set\*\* for (.+?): "(.+?)"/);
  if (reminderMatch) {
    const [, time, message] = reminderMatch;
    return (
      <div style={{
        background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)',
        borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>⏰</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Reminder Set</span>
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: '0.25rem' }}>{message}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>📅 {time}</div>
        </div>
      </div>
    );
  }

  // Board state summary
  const boardStateMatch = content.match(/📊 \*\*Board status:\*\*([\s\S]+)/);
  if (boardStateMatch) {
    return (
      <div style={{
        background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)',
        borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📊</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Board Status</span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
          {boardStateMatch[1].trim()}
        </div>
      </div>
    );
  }

  // File read result
  const fileReadMatch = content.match(/📄 \*\*File:\*\* `(.+?)`[\s\S]+```([\s\S]+?)```/);
  if (fileReadMatch) {
    const [, filePath, fileContent] = fileReadMatch;
    return (
      <div style={{
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📄</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>File Content</span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          <code style={{ background: 'var(--bg-primary)', padding: '0.1rem 0.3rem', borderRadius: '0.2rem' }}>{filePath}</code>
        </div>
        <pre style={{ 
          background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '0.25rem', 
          overflow: 'auto', maxHeight: '20rem', fontSize: '0.8rem', margin: 0,
          border: '1px solid var(--border)'
        }}>
          <code>{fileContent.trim()}</code>
        </pre>
      </div>
    );
  }

  // Default: render as markdown-style with @mentions
  return <span>{formatMessageContent(content, personas)}</span>;
}

function formatMessageContent(content: string, personas: Persona[]): JSX.Element {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const parts = content.split(mentionRegex);
  return (
    <span>
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const persona = personas.find(p => p.name === part);
          return (
            <span key={index} style={{
              background: 'var(--accent)', color: 'white',
              padding: '0.1rem 0.4rem', borderRadius: '0.3rem', fontWeight: 600,
              fontSize: '0.85em', display: 'inline-flex', alignItems: 'center',
              gap: '0.2rem', verticalAlign: 'baseline'
            }} title={persona ? `${persona.emoji} ${persona.description}` : undefined}>
              {persona?.emoji && <span style={{ fontSize: '0.9em' }}>{persona.emoji}</span>}
              @{part}
            </span>
          );
        }
        return part;
      })}
    </span>
  );
}
