import { useState, useEffect } from 'react';
import { Report, ReportMetadata } from '../types/index.js';

const API_BASE = 'http://localhost:3001/api';

export function useReports() {
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/reports`);
      if (!response.ok) {
        throw new Error(`Failed to fetch reports: ${response.status}`);
      }
      const data = await response.json();
      setReports(data.reports || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reports');
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  return {
    reports,
    loading,
    error,
    refetch: fetchReports
  };
}

export function useReport(id: string | undefined) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setReport(null);
      setLoading(false);
      return;
    }

    const fetchReport = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE}/reports/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Report not found');
          }
          throw new Error(`Failed to fetch report: ${response.status}`);
        }
        const data = await response.json();
        setReport(data.report || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch report');
        console.error('Error fetching report:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [id]);

  return {
    report,
    loading,
    error
  };
}

export async function deleteReport(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/reports/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete report: ${response.status}`);
    }
    return true;
  } catch (err) {
    console.error('Error deleting report:', err);
    return false;
  }
}