import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { useReport } from '../hooks/useReports.js';

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { report, loading, error } = useReport(id);

  const formatDate = (date: Date) => {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Use relative dates for recent items
    if (diffDays === 0) {
      return 'Today, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      // Nice format like "17 Feb 2026"
      return date.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <button 
            onClick={() => navigate('/reports')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              textDecoration: 'underline',
              padding: 0
            }}
          >
            ← Back to Reports
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>Loading report...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <button 
            onClick={() => navigate('/reports')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              textDecoration: 'underline',
              padding: 0
            }}
          >
            ← Back to Reports
          </button>
        </div>
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.3)', 
          borderRadius: '0.5rem', 
          padding: '1rem'
        }}>
          <p style={{ color: '#ef4444' }}>Error: {error || 'Report not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 1.5rem', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <button 
          onClick={() => navigate('/reports')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '0.375rem',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
          onMouseLeave={(e) => e.target.style.background = 'none'}
        >
          ← Back to Reports
        </button>
        
        <div style={{ 
          borderBottom: '1px solid var(--border)', 
          paddingBottom: '1.5rem',
          marginBottom: '2rem'
        }}>
          <h1 style={{ 
            fontSize: '2rem', 
            fontWeight: '700', 
            marginBottom: '1rem',
            color: 'var(--text-primary)',
            lineHeight: '1.2'
          }}>
            {report.title}
          </h1>
          
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            alignItems: 'center', 
            gap: '1rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem'
          }}>
            <span>📅 {formatDate(report.createdAt)}</span>
            {report.updatedAt && new Date(report.updatedAt).getTime() !== new Date(report.createdAt).getTime() && (
              <span>Updated: {formatDate(report.updatedAt)}</span>
            )}
            {report.taskId && (
              <Link 
                to={`/tasks/${report.taskId}`}
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '0.375rem',
                  textDecoration: 'none',
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--accent)';
                  e.target.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-tertiary)';
                  e.target.style.color = 'var(--text-secondary)';
                }}
              >
                🔗 View Related Task
              </Link>
            )}
          </div>
          
          {report.tags.length > 0 && (
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '0.375rem', 
              marginBottom: '1rem' 
            }}>
              {report.tags.map((tag, index) => (
                <span 
                  key={index} 
                  style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: 'var(--accent)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '1rem',
                    fontSize: '0.75rem',
                    fontWeight: '500'
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          {report.summary && (
            <div style={{ 
              marginTop: '1rem', 
              padding: '1rem', 
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.2)', 
              borderRadius: '0.5rem',
              borderLeft: '4px solid var(--accent)'
            }}>
              <h3 style={{ 
                fontWeight: '600', 
                color: 'var(--text-primary)', 
                marginBottom: '0.5rem',
                fontSize: '1rem'
              }}>
                📋 Summary
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                lineHeight: '1.5',
                margin: 0
              }}>
                {report.summary}
              </p>
            </div>
          )}
        </div>
      </div>
      
      <div style={{ 
        lineHeight: '1.6',
        color: 'var(--text-primary)'
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 style={{
                fontSize: '1.75rem',
                fontWeight: '700',
                marginTop: '2rem',
                marginBottom: '1rem',
                color: 'var(--text-primary)',
                borderBottom: '2px solid var(--border)',
                paddingBottom: '0.5rem'
              }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 style={{
                fontSize: '1.5rem',
                fontWeight: '600',
                marginTop: '1.5rem',
                marginBottom: '1rem',
                color: 'var(--text-primary)'
              }}>
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 style={{
                fontSize: '1.25rem',
                fontWeight: '600',
                marginTop: '1.25rem',
                marginBottom: '0.75rem',
                color: 'var(--text-primary)'
              }}>
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p style={{
                marginBottom: '1rem',
                lineHeight: '1.6',
                color: 'var(--text-secondary)'
              }}>
                {children}
              </p>
            ),
            code: ({ node, inline, className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? (
                <div style={{ margin: '1rem 0' }}>
                  <SyntaxHighlighter
                    style={tomorrow}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              ) : (
                <code
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)',
                    fontFamily: 'Monaco, Menlo, monospace'
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px'
                }}
              >
                {children}
              </a>
            ),
            ul: ({ children }) => (
              <ul style={{
                marginBottom: '1rem',
                paddingLeft: '1.5rem',
                color: 'var(--text-secondary)'
              }}>
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol style={{
                marginBottom: '1rem',
                paddingLeft: '1.5rem',
                color: 'var(--text-secondary)'
              }}>
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li style={{
                marginBottom: '0.25rem'
              }}>
                {children}
              </li>
            ),
            blockquote: ({ children }) => (
              <blockquote style={{
                borderLeft: '4px solid var(--accent)',
                paddingLeft: '1rem',
                margin: '1rem 0',
                background: 'var(--bg-secondary)',
                padding: '1rem',
                borderRadius: '0.375rem',
                fontStyle: 'italic'
              }}>
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: '0.375rem',
                  overflow: 'hidden'
                }}>
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th style={{
                padding: '0.75rem',
                textAlign: 'left',
                fontWeight: '600',
                color: 'var(--text-primary)',
                background: 'var(--bg-tertiary)',
                borderBottom: '1px solid var(--border)'
              }}>
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td style={{
                padding: '0.75rem',
                borderBottom: '1px solid var(--border)',
                color: 'var(--text-secondary)'
              }}>
                {children}
              </td>
            )
          }}
        >
          {report.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}