import { useState, useEffect } from 'react';
import { PRStatus } from '../types';

interface GitHubStatusProps {
  taskId: string;
  repo?: string;
  compact?: boolean;
}

export function GitHubStatus({ taskId, repo, compact = false }: GitHubStatusProps) {
  const [linkedPRs, setLinkedPRs] = useState<PRStatus[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (taskId) {
      loadGitHubData();
    }
  }, [taskId]);

  const loadGitHubData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/github/task/${taskId}`);
      if (response.ok) {
        const data = await response.json();
        setLinkedPRs(data.linkedPRs);
      }
    } catch (error) {
      console.error('Failed to load GitHub data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return compact ? (
      <span className="github-status loading">⏳</span>
    ) : (
      <div className="github-status loading">Loading GitHub status...</div>
    );
  }

  if (linkedPRs.length === 0) {
    return compact ? null : (
      <div className="github-status no-prs">No linked PRs</div>
    );
  }

  if (compact) {
    // Show a single status indicator for the card
    const pr = linkedPRs[0]; // Show status for the first/most recent PR
    const statusIcon = getPRStatusIcon(pr);
    const statusClass = getPRStatusClass(pr);
    
    return (
      <span className={`github-status compact ${statusClass}`} title={`PR #${pr.number}: ${pr.title}`}>
        {statusIcon}
      </span>
    );
  }

  // Full display for task modal
  return (
    <div className="github-status full">
      <h4>Linked Pull Requests</h4>
      {linkedPRs.map((pr) => (
        <div key={pr.number} className={`pr-status ${getPRStatusClass(pr)}`}>
          <div className="pr-header">
            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="pr-link">
              {getPRStatusIcon(pr)} PR #{pr.number}: {pr.title}
            </a>
            {pr.draft && <span className="draft-badge">Draft</span>}
          </div>
          
          <div className="pr-details">
            {/* Checks Status */}
            {pr.checks.length > 0 && (
              <div className="checks-status">
                <span className="label">Checks:</span>
                {getChecksStatus(pr.checks)}
              </div>
            )}
            
            {/* Review Status */}
            {pr.reviews.length > 0 && (
              <div className="reviews-status">
                <span className="label">Reviews:</span>
                {getReviewsStatus(pr.reviews)}
              </div>
            )}
            
            {/* Mergeable Status */}
            {pr.state === 'open' && (
              <div className="mergeable-status">
                <span className="label">Mergeable:</span>
                <span className={pr.mergeable ? 'mergeable-yes' : 'mergeable-no'}>
                  {pr.mergeable ? '✅ Yes' : '❌ No'}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function getPRStatusIcon(pr: PRStatus): string {
  if (pr.state === 'merged') return '🟣';
  if (pr.state === 'closed') return '🔴';
  if (pr.draft) return '⚪';
  
  // Open PR - check status based on checks and reviews
  const hasFailingChecks = pr.checks.some(check => check.conclusion === 'failure');
  const hasApproval = pr.reviews.some(review => review.state === 'APPROVED');
  const hasChangesRequested = pr.reviews.some(review => review.state === 'REQUEST_CHANGES');
  
  if (hasFailingChecks) return '🔴';
  if (hasChangesRequested) return '🟡';
  if (hasApproval && pr.mergeable) return '🟢';
  if (pr.checks.length > 0 && pr.checks.every(check => check.conclusion === 'success')) return '🟢';
  
  return '🟡'; // Pending/in progress
}

function getPRStatusClass(pr: PRStatus): string {
  if (pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.draft) return 'draft';
  
  const hasFailingChecks = pr.checks.some(check => check.conclusion === 'failure');
  const hasApproval = pr.reviews.some(review => review.state === 'APPROVED');
  const hasChangesRequested = pr.reviews.some(review => review.state === 'REQUEST_CHANGES');
  
  if (hasFailingChecks) return 'failing';
  if (hasChangesRequested) return 'changes-requested';
  if (hasApproval && pr.mergeable) return 'approved';
  if (pr.checks.length > 0 && pr.checks.every(check => check.conclusion === 'success')) return 'passing';
  
  return 'pending';
}

function getChecksStatus(checks: PRStatus['checks']): JSX.Element {
  const passing = checks.filter(check => check.conclusion === 'success').length;
  const failing = checks.filter(check => check.conclusion === 'failure').length;
  const pending = checks.filter(check => check.status !== 'completed').length;
  
  return (
    <span className="checks-summary">
      {passing > 0 && <span className="checks-passing">✅ {passing}</span>}
      {failing > 0 && <span className="checks-failing">❌ {failing}</span>}
      {pending > 0 && <span className="checks-pending">⏳ {pending}</span>}
    </span>
  );
}

function getReviewsStatus(reviews: PRStatus['reviews']): JSX.Element {
  // Get the latest review from each reviewer
  const latestReviews = reviews.reduce((acc, review) => {
    acc[review.reviewer] = review;
    return acc;
  }, {} as Record<string, PRStatus['reviews'][0]>);
  
  const approved = Object.values(latestReviews).filter(r => r.state === 'APPROVED').length;
  const changesRequested = Object.values(latestReviews).filter(r => r.state === 'REQUEST_CHANGES').length;
  
  return (
    <span className="reviews-summary">
      {approved > 0 && <span className="reviews-approved">✅ {approved}</span>}
      {changesRequested > 0 && <span className="reviews-changes">❌ {changesRequested}</span>}
    </span>
  );
}