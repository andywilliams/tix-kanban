import React, { useState, useEffect } from 'react';

interface BudgetStatus {
  tokensUsed: number;
  tokenLimit: number;
  percentage: number;
  paused: boolean;
  month: string;
}

interface PersonaBudgetDisplayProps {
  personaId: string;
}

export function PersonaBudgetDisplay({ personaId }: PersonaBudgetDisplayProps) {
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBudgetStatus();
  }, [personaId]);

  const fetchBudgetStatus = async () => {
    try {
      const response = await fetch(`/api/personas/${personaId}/budget-status`);
      if (response.ok) {
        const data = await response.json();
        setBudgetStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch budget status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  if (!budgetStatus || budgetStatus.tokenLimit === 0) {
    return null; // No budget limit configured
  }

  const { tokensUsed, tokenLimit, percentage, paused } = budgetStatus;

  // Determine color based on percentage
  let barColor = '#22c55e'; // green
  let bgColor = 'rgba(34, 197, 94, 0.1)';
  
  if (percentage >= 100) {
    barColor = '#ef4444'; // red
    bgColor = 'rgba(239, 68, 68, 0.1)';
  } else if (percentage >= 80) {
    barColor = '#f59e0b'; // amber
    bgColor = 'rgba(245, 158, 11, 0.1)';
  }

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(0)}K`;
    }
    return tokens.toString();
  };

  return (
    <div style={{
      margin: '0.75rem 0',
      padding: '0.75rem',
      background: bgColor,
      borderRadius: '0.5rem',
      border: `1px solid ${paused ? barColor : 'var(--border)'}`,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.5rem',
      }}>
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          🪙 Token Budget {paused && <span style={{ color: barColor, marginLeft: '0.5rem' }}>⚠️ PAUSED</span>}
        </div>
        <div style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
        }}>
          {formatTokens(tokensUsed)} / {formatTokens(tokenLimit)} ({Math.round(percentage)}%)
        </div>
      </div>
      
      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: '6px',
        background: 'var(--bg-secondary)',
        borderRadius: '3px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(percentage, 100)}%`,
          height: '100%',
          background: barColor,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {paused && (
        <div style={{
          marginTop: '0.5rem',
          fontSize: '0.7rem',
          color: barColor,
          fontWeight: 500,
        }}>
          This persona is paused due to budget exceeded. Resets on {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </div>
      )}
    </div>
  );
}
