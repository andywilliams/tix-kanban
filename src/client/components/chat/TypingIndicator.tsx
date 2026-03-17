import React from 'react';
import { Persona } from '../../types';

interface TypingIndicatorProps {
  persona: Persona;
}

export default function TypingIndicator({ persona }: TypingIndicatorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', opacity: 0.7 }}>
      <div style={{
        width: '2.25rem', height: '2.25rem', background: 'var(--bg-tertiary)', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
        flexShrink: 0, color: 'var(--text-primary)', border: '1px solid var(--border)'
      }}>
        {persona.emoji}
      </div>
      <div style={{ flex: 1, paddingTop: '0.5rem' }}>
        <div style={{ 
          display: 'inline-block',
          background: 'var(--bg-tertiary)', 
          borderRadius: '1rem',
          padding: '0.75rem 1rem',
          fontSize: '0.875rem',
          color: 'var(--text-muted)'
        }}>
          <span style={{ fontWeight: 500 }}>
            {persona.name}
          </span>
          {' is thinking'}
          <span className="typing-dots" style={{ display: 'inline-block', marginLeft: '0.25rem' }}>
            <span style={{ animation: 'typing 1.4s infinite', animationDelay: '0s' }}>.</span>
            <span style={{ animation: 'typing 1.4s infinite', animationDelay: '0.2s' }}>.</span>
            <span style={{ animation: 'typing 1.4s infinite', animationDelay: '0.4s' }}>.</span>
          </span>
        </div>
      </div>
    </div>
  );
}
