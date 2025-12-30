import React, { useState } from 'react';
import './FeedbackModal.css';

const FeedbackModal = ({ isOpen, onClose, onSubmit, isSubmitting = false }) => {
  const [feedback, setFeedback] = useState('');
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!feedback.trim()) {
      return;
    }
    onSubmit({
      feedback: feedback.trim(),
      email: email.trim() || null
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="feedback-modal-overlay" 
      onClick={handleBackdropClick}
      onKeyDown={handleKeyPress}
    >
      <div className="feedback-modal-content">
        <div className="feedback-modal-header">
          <h2 className="feedback-modal-title">Leave Feedback</h2>
          <button 
            className="feedback-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="feedback-modal-form">
          <div className="feedback-form-group">
            <label htmlFor="feedback-text" className="feedback-form-label">
              Your Feedback
            </label>
            <textarea
              id="feedback-text"
              className="feedback-textarea"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Share your thoughts, suggestions, or report issues..."
              rows={6}
              required
              autoFocus
            />
          </div>

          <div className="feedback-form-group">
            <label htmlFor="feedback-email" className="feedback-form-label">
              Email (Optional)
            </label>
            <input
              id="feedback-email"
              type="email"
              className="feedback-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@example.com"
            />
            <p className="feedback-form-hint">
              Optional: Provide your email if you'd like us to follow up on your feedback.
            </p>
          </div>

          <div className="feedback-modal-actions">
            <button
              type="button"
              className="feedback-button feedback-button-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="feedback-button feedback-button-submit"
              disabled={!feedback.trim() || isSubmitting}
            >
              {isSubmitting ? 'Sending...' : 'Send Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FeedbackModal;

