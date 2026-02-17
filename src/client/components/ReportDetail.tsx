import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useReport } from '../hooks/useReports.js';

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { report, loading, error } = useReport(id);

  const formatDate = (date: Date) => {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // Simple markdown renderer for basic formatting
  const renderMarkdown = (content: string) => {
    if (!content) return '';
    
    // Convert markdown to HTML (basic implementation)
    let html = content
      // Headers
      .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mt-6 mb-3">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mt-6 mb-4">$1</h2>')
      .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>')
      // Bold and italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```\w*\n?/, '').replace(/```$/, '');
        return `<pre class="bg-gray-100 p-4 rounded mt-4 mb-4 overflow-x-auto"><code>${code}</code></pre>`;
      })
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm">$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mb-4">')
      // Lists
      .replace(/^- (.*)$/gm, '<li class="ml-4">• $1</li>')
      .replace(/^(\d+)\. (.*)$/gm, '<li class="ml-4">$1. $2</li>');
    
    // Wrap in paragraphs
    if (!html.includes('<h1') && !html.includes('<h2') && !html.includes('<h3')) {
      html = `<p class="mb-4">${html}</p>`;
    }
    
    return html;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <button 
            onClick={() => navigate('/reports')}
            className="text-blue-600 hover:underline"
          >
            ← Back to Reports
          </button>
        </div>
        <p>Loading report...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <button 
            onClick={() => navigate('/reports')}
            className="text-blue-600 hover:underline"
          >
            ← Back to Reports
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">Error: {error || 'Report not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <button 
          onClick={() => navigate('/reports')}
          className="text-blue-600 hover:underline mb-4"
        >
          ← Back to Reports
        </button>
        
        <div className="border-b pb-4">
          <h1 className="text-3xl font-bold mb-2">{report.title}</h1>
          
          <div className="flex flex-wrap items-center text-sm text-gray-600 space-x-4">
            <span>Created: {formatDate(report.createdAt)}</span>
            {report.updatedAt && new Date(report.updatedAt).getTime() !== new Date(report.createdAt).getTime() && (
              <span>Updated: {formatDate(report.updatedAt)}</span>
            )}
            {report.taskId && (
              <Link 
                to={`/tasks/${report.taskId}`}
                className="bg-blue-100 px-2 py-1 rounded hover:bg-blue-200"
              >
                View Related Task
              </Link>
            )}
            <span className="font-mono text-xs">{report.filename}</span>
          </div>
          
          {report.tags.length > 0 && (
            <div className="flex space-x-2 mt-3">
              {report.tags.map((tag, index) => (
                <span key={index} className="bg-gray-100 px-2 py-1 rounded text-sm">
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          {report.summary && (
            <div className="mt-4 p-4 bg-blue-50 rounded">
              <h3 className="font-semibold text-blue-900 mb-2">Summary</h3>
              <p className="text-blue-800">{report.summary}</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="prose prose-lg max-w-none">
        <div 
          className="report-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
        />
      </div>
    </div>
  );
}