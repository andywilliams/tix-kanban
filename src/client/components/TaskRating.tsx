import React, { useState } from 'react';
import { Task, TaskRating } from '../types';

interface TaskRatingProps {
  task: Task;
  onSubmitRating: (rating: 'good' | 'needs-improvement' | 'redo', comment?: string) => void;
  isSubmitting?: boolean;
}

const TaskRating: React.FC<TaskRatingProps> = ({ 
  task, 
  onSubmitRating, 
  isSubmitting = false 
}) => {
  const [selectedRating, setSelectedRating] = useState<'good' | 'needs-improvement' | 'redo' | null>(null);
  const [comment, setComment] = useState('');
  const [showCommentForm, setShowCommentForm] = useState(false);

  const handleRatingSelect = (rating: 'good' | 'needs-improvement' | 'redo') => {
    setSelectedRating(rating);
    // Automatically show comment form for needs-improvement and redo
    if (rating === 'needs-improvement' || rating === 'redo') {
      setShowCommentForm(true);
    } else {
      setShowCommentForm(false);
    }
  };

  const handleSubmit = () => {
    if (!selectedRating) return;
    onSubmitRating(selectedRating, comment.trim() || undefined);
    
    // Reset form
    setSelectedRating(null);
    setComment('');
    setShowCommentForm(false);
  };

  const getRatingIcon = (rating: 'good' | 'needs-improvement' | 'redo') => {
    switch (rating) {
      case 'good':
        return '✅';
      case 'needs-improvement':
        return '⚠️';
      case 'redo':
        return '❌';
    }
  };

  const getRatingLabel = (rating: 'good' | 'needs-improvement' | 'redo') => {
    switch (rating) {
      case 'good':
        return 'Good';
      case 'needs-improvement':
        return 'Needs Improvement';
      case 'redo':
        return 'Redo';
    }
  };

  const getRatingColor = (rating: 'good' | 'needs-improvement' | 'redo') => {
    switch (rating) {
      case 'good':
        return '#22c55e';
      case 'needs-improvement':
        return '#f59e0b';
      case 'redo':
        return '#ef4444';
    }
  };

  // If task already has a rating, show it
  if (task.rating) {
    return (
      <div className="task-rating-display">
        <h4>Task Rating</h4>
        <div className="rating-result">
          <div className="rating-badge" style={{ backgroundColor: getRatingColor(task.rating.rating) }}>
            {getRatingIcon(task.rating.rating)} {getRatingLabel(task.rating.rating)}
          </div>
          <div className="rating-meta">
            <span>Rated by {task.rating.ratedBy}</span>
            <span>on {task.rating.ratedAt.toLocaleString()}</span>
          </div>
        </div>
        {task.rating.comment && (
          <div className="rating-comment">
            <strong>Feedback:</strong>
            <p>{task.rating.comment}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="task-rating-form">
      <h4>Rate this work</h4>
      <p>How would you rate the quality of this completed task?</p>
      
      <div className="rating-options">
        {(['good', 'needs-improvement', 'redo'] as const).map(rating => (
          <button
            key={rating}
            className={`rating-option ${selectedRating === rating ? 'selected' : ''}`}
            onClick={() => handleRatingSelect(rating)}
            style={{ 
              borderColor: selectedRating === rating ? getRatingColor(rating) : '#ccc',
              backgroundColor: selectedRating === rating ? getRatingColor(rating) + '20' : 'transparent'
            }}
          >
            <div className="rating-icon">{getRatingIcon(rating)}</div>
            <div className="rating-label">{getRatingLabel(rating)}</div>
          </button>
        ))}
      </div>

      {(showCommentForm || selectedRating === 'good') && (
        <div className="rating-comment-form">
          <label htmlFor="rating-comment">
            {selectedRating === 'good' ? 'Additional feedback (optional):' : 'Please explain what needs improvement:'}
          </label>
          <textarea
            id="rating-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={selectedRating === 'good' 
              ? "What did the persona do well?" 
              : "What specifically needs to be improved or redone?"}
            rows={3}
          />
        </div>
      )}

      <div className="rating-actions">
        <button
          className="btn btn-secondary"
          onClick={() => {
            setSelectedRating(null);
            setComment('');
            setShowCommentForm(false);
          }}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={!selectedRating || isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Rating'}
        </button>
      </div>
    </div>
  );
};

export default TaskRating;