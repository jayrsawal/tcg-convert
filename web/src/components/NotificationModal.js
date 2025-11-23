import React from 'react';
import './NotificationModal.css';

const NotificationModal = ({ isOpen, onClose, title, message, type = 'info' }) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      default:
        return 'ℹ';
    }
  };

  return (
    <>
      <div className="notification-overlay" onClick={onClose} />
      <div className={`notification-modal notification-${type}`}>
        <div className="notification-header">
          <span className="notification-icon">{getIcon()}</span>
          <h3 className="notification-title">{title}</h3>
          <button className="notification-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="notification-content">
          <p>{message}</p>
        </div>
        <div className="notification-actions">
          <button className="notification-button" onClick={onClose}>OK</button>
        </div>
      </div>
    </>
  );
};

export default NotificationModal;

