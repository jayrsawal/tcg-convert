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
 * @param {React.ReactNode} props.meta - Meta information to display below the title (e.g., deck settings)
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.maxPercentage - Max percentage for market histogram (optional)
 * @param {Function} props.setMaxPercentage - Function to set max percentage (optional)
 */
const PageHeader = ({
  title,
  actions,
  badge,
  titleActions,
  meta,
  className = '',
  maxPercentage,
  setMaxPercentage
}) => {
  const headerClass = `page-header ${className}`.trim();

  return (
    <div className={headerClass}>
      <div className="page-header-display">
        <div className="page-header-title-section">
          <div className="page-header-title-wrapper">
            <h2 className="page-header-title">{title}</h2>
            {titleActions}
            {badge && <span className="page-header-badge">{badge}</span>}
          </div>
          {meta && <div className="page-header-meta">{meta}</div>}
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

