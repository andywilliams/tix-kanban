import React, { useState, useEffect } from 'react';

interface TagSuggestion {
  tag: string;
  confidence: number;
  reason: string;
}

interface TagSuggestionsProps {
  taskId?: string;
  title: string;
  description: string;
  currentTags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

export function TagSuggestions({
  taskId,
  title,
  description,
  currentTags,
  onAddTag,
  onRemoveTag,
}: TagSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);

  useEffect(() => {
    // Fetch available tags on mount
    fetch('/api/tags/available')
      .then(res => res.json())
      .then(data => setAllTags(data.tags || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Debounce suggestion fetching
    const timer = setTimeout(() => {
      if (title.length > 3 || description.length > 10) {
        analyzeTags();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [title, description]);

  const analyzeTags = async () => {
    if (!title && !description) return;
    
    setLoading(true);
    try {
      // For new tasks, we analyze locally
      // For existing tasks, we can use the API
      if (taskId) {
        const res = await fetch(`/api/tasks/${taskId}/tags/suggest`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } else {
        // Simple local analysis for new tasks
        const content = `${title} ${description}`.toLowerCase();
        const localSuggestions: TagSuggestion[] = [];
        
        // Quick pattern matching
        const patterns: Array<{ tag: string; keywords: string[] }> = [
          { tag: 'bug', keywords: ['bug', 'fix', 'error', 'broken', 'issue'] },
          { tag: 'feature', keywords: ['feature', 'add', 'new', 'implement', 'create'] },
          { tag: 'frontend', keywords: ['react', 'ui', 'component', 'css', 'layout', 'button'] },
          { tag: 'backend', keywords: ['api', 'server', 'endpoint', 'database'] },
          { tag: 'docs', keywords: ['document', 'readme', 'docs'] },
          { tag: 'testing', keywords: ['test', 'spec', 'coverage'] },
          { tag: 'refactor', keywords: ['refactor', 'cleanup', 'improve'] },
          { tag: 'urgent', keywords: ['urgent', 'asap', 'critical', 'blocker'] },
          { tag: 'performance', keywords: ['performance', 'slow', 'optimize', 'speed'] },
        ];
        
        for (const p of patterns) {
          if (currentTags.includes(p.tag)) continue;
          
          const matches = p.keywords.filter(kw => content.includes(kw));
          if (matches.length > 0) {
            localSuggestions.push({
              tag: p.tag,
              confidence: Math.min(0.9, 0.4 + matches.length * 0.2),
              reason: `Contains: ${matches.join(', ')}`,
            });
          }
        }
        
        setSuggestions(localSuggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5));
      }
    } catch (error) {
      console.error('Failed to analyze tags:', error);
    }
    setLoading(false);
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.7) return '#10b981'; // green
    if (confidence >= 0.5) return '#f59e0b'; // yellow
    return '#6b7280'; // gray
  };

  const filteredSuggestions = suggestions.filter(s => !currentTags.includes(s.tag));
  const availableTags = allTags.filter(t => !currentTags.includes(t));

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {/* Current Tags */}
      {currentTags.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            Current tags:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {currentTags.map(tag => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.2rem 0.5rem',
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: '0.25rem',
                  fontSize: '0.8rem',
                }}
              >
                {tag}
                <button
                  onClick={() => onRemoveTag(tag)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    padding: '0 0.1rem',
                    opacity: 0.7,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestions */}
      {filteredSuggestions.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ 
            fontSize: '0.75rem', 
            color: 'var(--text-muted)', 
            marginBottom: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}>
            ✨ Suggested tags:
            {loading && <span style={{ fontSize: '0.7rem' }}>(analyzing...)</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {filteredSuggestions.map(suggestion => (
              <button
                key={suggestion.tag}
                onClick={() => onAddTag(suggestion.tag)}
                title={`${suggestion.reason} (${Math.round(suggestion.confidence * 100)}% confident)`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.2rem 0.5rem',
                  background: `${getConfidenceColor(suggestion.confidence)}20`,
                  color: getConfidenceColor(suggestion.confidence),
                  border: `1px dashed ${getConfidenceColor(suggestion.confidence)}`,
                  borderRadius: '0.25rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = `${getConfidenceColor(suggestion.confidence)}40`;
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = `${getConfidenceColor(suggestion.confidence)}20`;
                }}
              >
                + {suggestion.tag}
                <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All Available Tags */}
      <div>
        <button
          onClick={() => setShowAllTags(!showAllTags)}
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {showAllTags ? 'Hide all tags ▲' : 'Show all tags ▼'}
        </button>
        
        {showAllTags && availableTags.length > 0 && (
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '0.25rem',
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: 'var(--bg-tertiary)',
            borderRadius: '0.25rem',
          }}>
            {availableTags.map(tag => (
              <button
                key={tag}
                onClick={() => onAddTag(tag)}
                style={{
                  padding: '0.15rem 0.4rem',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TagSuggestions;
