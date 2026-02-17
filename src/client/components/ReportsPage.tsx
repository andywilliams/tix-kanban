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
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getPreview = (report: ReportMetadata) => {
    if (report.summary && report.summary.trim()) {
      return report.summary;
    }
    return 'No summary available';
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Reports</h1>
        <p>Loading reports...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Reports</h1>
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">Error: {error}</p>
          <button 
            onClick={refetch}
            className="mt-2 px-3 py-1 bg-red-100 hover:bg-red-200 rounded text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button 
          onClick={refetch}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No reports found</p>
          <p className="text-sm text-gray-400">
            Create a task with "research" in the title or tags to generate reports
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reports.map((report) => (
            <div 
              key={report.id} 
              className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer bg-white"
            >
              <div 
                className="flex-1"
                onClick={() => navigate(`/reports/${report.id}`)}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-medium text-blue-600 hover:text-blue-800">
                    {report.title}
                  </h3>
                  <div className="flex items-center space-x-2 ml-4">
                    {report.taskId && (
                      <span 
                        className="text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/tasks/${report.taskId}`);
                        }}
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
                      className="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded hover:bg-red-50"
                    >
                      {deletingId === report.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
                
                <p className="text-gray-600 text-sm mb-3">{getPreview(report)}</p>
                
                <div className="flex justify-between items-center text-xs text-gray-500">
                  <div className="flex items-center space-x-4">
                    <span>Created: {formatDate(report.createdAt)}</span>
                    {report.tags.length > 0 && (
                      <div className="flex space-x-1">
                        {report.tags.slice(0, 3).map((tag, index) => (
                          <span key={index} className="bg-gray-100 px-2 py-1 rounded">
                            {tag}
                          </span>
                        ))}
                        {report.tags.length > 3 && (
                          <span className="text-gray-400">+{report.tags.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="font-mono">{report.filename}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}