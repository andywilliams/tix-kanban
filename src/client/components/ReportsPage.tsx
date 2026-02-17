import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReports, deleteReport } from '../hooks/useReports.js';
import { ReportMetadata } from '../types/index.js';

export function ReportsPage() {
  const { reports, loading, error, refetch } = useReports();
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteReport = async (id: string) => {
    if (!confirm('Are you sure you want to delete this report?')) {
      return;
    }

    setDeletingId(id);
    const success = await deleteReport(id);
    setDeletingId(null);

    if (success) {
      refetch(); // Refresh the list
    } else {
      alert('Failed to delete report');
    }
  };

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
        year: 'numeric' 
      });
    }
  };

  const getPreview = (report: ReportMetadata) => {
    if (report.summary && report.summary.trim()) {
      // Limit preview to 2-3 lines max (~150 chars)
      const preview = report.summary.slice(0, 150);
      return preview + (report.summary.length > 150 ? '...' : '');
    }
    return 'No summary available';
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ 
          fontSize: '1.75rem', 
          fontWeight: '700', 
          color: 'var(--text-primary)', 
          marginBottom: '2rem' 
        }}>
          Reports
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>Loading reports...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ 
          fontSize: '1.75rem', 
          fontWeight: '700', 
          color: 'var(--text-primary)', 
          marginBottom: '2rem' 
        }}>
          Reports
        </h1>
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.3)', 
          borderRadius: '0.5rem', 
          padding: '1rem',
          marginBottom: '1.5rem'
        }}>
          <p style={{ color: '#ef4444', marginBottom: '0.5rem' }}>Error: {error}</p>
          <button 
            onClick={refetch}
            style={{
              padding: '0.5rem 1rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '0.375rem',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '2rem' 
      }}>
        <h1 style={{ 
          fontSize: '1.75rem', 
          fontWeight: '700', 
          color: 'var(--text-primary)' 
        }}>
          Reports
        </h1>
        <button 
          onClick={refetch}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: '500',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.background = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.target.style.background = 'var(--accent)'}
        >
          🔄 Refresh
        </button>
      </div>

      {reports.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📄</div>
          <h3 style={{
            fontSize: '1.25rem',
            color: 'var(--text-primary)',
            marginBottom: '0.5rem'
          }}>
            No reports yet
          </h3>
          <p style={{
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem'
          }}>
            Create a task with "research" in the title or tags to generate reports
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {reports.map((report) => (
            <div 
              key={report.id} 
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '0.75rem',
                padding: '1.25rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: 'var(--shadow)'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = 'var(--shadow-lg)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'var(--shadow)';
              }}
            >
              <div onClick={() => navigate(`/reports/${report.id}`)}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'flex-start', 
                  marginBottom: '0.75rem' 
                }}>
                  <h3 style={{ 
                    fontSize: '1.125rem', 
                    fontWeight: '600', 
                    color: 'var(--text-primary)', 
                    margin: 0,
                    lineHeight: '1.3'
                  }}>
                    {report.title}
                  </h3>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    marginLeft: '1rem',
                    flexShrink: 0
                  }}>
                    {report.taskId && (
                      <span 
                        style={{
                          fontSize: '0.75rem',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/tasks/${report.taskId}`);
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'var(--accent)'}
                        onMouseLeave={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                      >
                        Task: {report.taskId.slice(-8)}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteReport(report.id);
                      }}
                      disabled={deletingId === report.id}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: deletingId === report.id ? 'not-allowed' : 'pointer',
                        padding: '0.25rem',
                        borderRadius: '0.25rem',
                        fontSize: '1.1rem',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (deletingId !== report.id) {
                          e.target.style.color = 'var(--error)';
                          e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.color = 'var(--text-muted)';
                        e.target.style.background = 'none';
                      }}
                      title="Delete report"
                    >
                      {deletingId === report.id ? '⏳' : '🗑️'}
                    </button>
                  </div>
                </div>
                
                <p style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '0.875rem', 
                  marginBottom: '1rem',
                  lineHeight: '1.4'
                }}>
                  {getPreview(report)}
                </p>
                
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '1rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)'
                  }}>
                    <span>{formatDate(report.createdAt)}</span>
                    {report.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        {report.tags.slice(0, 3).map((tag, index) => (
                          <span 
                            key={index} 
                            style={{
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: 'var(--accent)',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '1rem',
                              fontSize: '0.7rem',
                              fontWeight: '500'
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                        {report.tags.length > 3 && (
                          <span style={{ 
                            color: 'var(--text-muted)',
                            fontSize: '0.7rem'
                          }}>
                            +{report.tags.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}