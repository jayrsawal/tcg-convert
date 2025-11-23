import React from 'react';
import './ConfirmationModal.css';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="confirmation-overlay" onClick={onClose} />
      <div className="confirmation-modal">
        <div className="confirmation-header">
          <h3 className="confirmation-title">{title}</h3>
          <button className="confirmation-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="confirmation-content">
          <p>{message}</p>
        </div>
        <div className="confirmation-actions">
          <button className="confirmation-button confirmation-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="confirmation-button confirmation-confirm" onClick={() => {
            if (onConfirm) {
              onConfirm();
            }
            onClose();
          }}>
            Confirm
          </button>
        </div>
      </div>
    </>
  );
};

export default ConfirmationModal;

