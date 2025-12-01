import React from 'react';
import './PageHeader.css';

/**
 * Shared PageHeader component for consistent header styling across pages
 * 
 * @param {Object} props
 * @param {string} props.title - The main title to display
 * @param {React.ReactNode} props.actions - Actions/buttons to display on the right (e.g., Import/Export button)
 * @param {React.ReactNode} props.badge - Badge text to display on the right (e.g., "Inventory Manager", "Deck Builder")
 * @param {React.ReactNode} props.titleActions - Actions to display next to the title (e.g., edit button)
 * @param {boolean} props.showEditButton - Whether to show an edit button next to the title
 * @param {Function} props.onEditClick - Callback when edit button is clicked
 * @param {boolean} props.editing - Whether the title is in edit mode
 * @param {string} props.editValue - Current value when editing
 * @param {Function} props.onEditChange - Callback when edit value changes
 * @param {Function} props.onEditSave - Callback when edit is saved
 * @param {Function} props.onEditCancel - Callback when edit is cancelled
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.maxPercentage - Max percentage for market histogram (optional)
 * @param {Function} props.setMaxPercentage - Function to set max percentage (optional)
 */
const PageHeader = ({
  title,
  actions,
  badge,
  titleActions,
  showEditButton = false,
  onEditClick,
  editing = false,
  editValue = '',
  onEditChange,
  onEditSave,
  onEditCancel,
  className = '',
  maxPercentage,
  setMaxPercentage
}) => {
  const headerClass = `page-header ${className}`.trim();

  if (editing) {
    return (
      <div className={headerClass}>
        <div className="page-header-edit">
          <div className="page-header-title-section">
            <input
              type="text"
              className="page-header-input"
              value={editValue}
              onChange={(e) => onEditChange && onEditChange(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  onEditSave && onEditSave();
                } else if (e.key === 'Escape') {
                  onEditCancel && onEditCancel();
                }
              }}
              autoFocus
            />
            {badge && <span className="page-header-badge">{badge}</span>}
          </div>
          <div className="page-header-edit-actions">
            <button className="save-name-button" onClick={onEditSave}>
              Save
            </button>
            <button className="cancel-name-button" onClick={onEditCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={headerClass}>
      <div className="page-header-display">
        <div className="page-header-title-section">
          <h2 className="page-header-title">{title}</h2>
          {titleActions}
          {showEditButton && onEditClick && (
            <button className="edit-name-button" onClick={onEditClick}>
              ✏️
            </button>
          )}
          {badge && <span className="page-header-badge">{badge}</span>}
          </div>
          <div className="page-header-actions">
          {/* Market controls (max percentage) */}
          {maxPercentage !== undefined && setMaxPercentage && (
            <div className="page-header-market-controls">
              <div className="page-header-max-percentage">
                <label htmlFor="page-header-max-percentage-slider" className="max-percentage-label">
                  TCG %:
                </label>
                <div className="max-percentage-slider-container">
                  <input
                    type="range"
                    id="page-header-max-percentage-slider"
                    className="max-percentage-slider"
                    min="0"
                    max="100"
                    step="5"
                    value={maxPercentage}
                    onChange={(e) => setMaxPercentage(parseInt(e.target.value, 10))}
                  />
                  <span className="max-percentage-value">{maxPercentage}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {actions}
    </div>
  );
};

export default PageHeader;

