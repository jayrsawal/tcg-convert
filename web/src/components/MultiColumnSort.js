import React, { useState, useEffect } from 'react';
import './MultiColumnSort.css';

/**
 * MultiColumnSort component for managing multi-column sorting
 * Allows users to add/remove/reorder sort columns and set direction for each
 */
const MultiColumnSort = ({ sortColumns = [], sortDirections = [], onChange, onApply, availableColumns = [] }) => {
  const [pendingColumns, setPendingColumns] = useState(sortColumns || []);
  const [pendingDirections, setPendingDirections] = useState(sortDirections || []);
  const [isOpen, setIsOpen] = useState(false);

  // Default available columns if not provided
  const defaultColumns = [
    { value: 'name', label: 'Name' },
    { value: 'number', label: 'Number' },
    { value: 'group_id', label: 'Set' },
    { value: 'rarity', label: 'Rarity' },
    { value: 'color', label: 'Color' },
    { value: 'type', label: 'Type' },
    { value: 'level', label: 'Level' },
    { value: 'cost', label: 'Cost' },
    { value: 'atk', label: 'ATK' },
    { value: 'hp', label: 'HP' },
  ];

  const columnsToUse = availableColumns.length > 0 ? availableColumns : defaultColumns;

  // Sync with props
  useEffect(() => {
    setPendingColumns(sortColumns || []);
    setPendingDirections(sortDirections || []);
  }, [sortColumns, sortDirections]);

  // Initialize pending state when opening
  useEffect(() => {
    if (isOpen) {
      setPendingColumns(sortColumns || []);
      setPendingDirections(sortDirections || []);
    }
  }, [isOpen, sortColumns, sortDirections]);

  // Get available columns that aren't already selected
  const getAvailableColumns = () => {
    return columnsToUse.filter(col => !pendingColumns.includes(col.value));
  };

  const handleAddColumn = (columnValue) => {
    const newColumns = [...pendingColumns, columnValue];
    const newDirections = [...pendingDirections, 'asc'];
    setPendingColumns(newColumns);
    setPendingDirections(newDirections);
  };

  const handleRemoveColumn = (index) => {
    const newColumns = pendingColumns.filter((_, i) => i !== index);
    const newDirections = pendingDirections.filter((_, i) => i !== index);
    setPendingColumns(newColumns);
    setPendingDirections(newDirections);
  };

  const handleDirectionChange = (index, direction) => {
    const newDirections = [...pendingDirections];
    newDirections[index] = direction;
    setPendingDirections(newDirections);
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newColumns = [...pendingColumns];
    const newDirections = [...pendingDirections];
    [newColumns[index], newColumns[index - 1]] = [newColumns[index - 1], newColumns[index]];
    [newDirections[index], newDirections[index - 1]] = [newDirections[index - 1], newDirections[index]];
    setPendingColumns(newColumns);
    setPendingDirections(newDirections);
  };

  const handleMoveDown = (index) => {
    if (index === pendingColumns.length - 1) return;
    const newColumns = [...pendingColumns];
    const newDirections = [...pendingDirections];
    [newColumns[index], newColumns[index + 1]] = [newColumns[index + 1], newColumns[index]];
    [newDirections[index], newDirections[index + 1]] = [newDirections[index + 1], newDirections[index]];
    setPendingColumns(newColumns);
    setPendingDirections(newDirections);
  };

  const handleClearAll = () => {
    setPendingColumns([]);
    setPendingDirections([]);
  };

  const handleApply = () => {
    if (onApply) {
      onApply(pendingColumns, pendingDirections);
    } else if (onChange) {
      // Fallback to immediate onChange if onApply not provided
      onChange(pendingColumns, pendingDirections);
    }
    setIsOpen(false);
  };

  const handleCancel = () => {
    // Reset to current applied values
    setPendingColumns(sortColumns || []);
    setPendingDirections(sortDirections || []);
    setIsOpen(false);
  };

  const hasChanges = () => {
    if (pendingColumns.length !== (sortColumns || []).length) return true;
    if (pendingColumns.some((col, i) => col !== (sortColumns || [])[i])) return true;
    if (pendingDirections.some((dir, i) => dir !== (sortDirections || [])[i])) return true;
    return false;
  };

  const getColumnLabel = (value) => {
    const col = columnsToUse.find(c => c.value === value);
    return col ? col.label : value;
  };

  return (
    <div className="multi-column-sort">
      <button
        className="attribute-filters-toggle"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="sort-icon">🔀</span>
        <span>Sort</span>
        {(sortColumns || []).length > 0 && (
          <span className="sort-badge">{(sortColumns || []).length}</span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="multi-column-sort-overlay"
            onClick={() => setIsOpen(false)}
          />
          <div className="multi-column-sort-panel">
            <div className="multi-column-sort-header">
              <h3>Multi-Column Sort</h3>
              <button
                className="close-sort-button"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="multi-column-sort-content">
              {pendingColumns.length === 0 ? (
                <div className="no-sort-columns">
                  <p>No sort columns selected. Add columns below to sort products.</p>
                </div>
              ) : (
                <div className="sort-columns-list">
                  {pendingColumns.map((column, index) => (
                    <div key={`${column}-${index}`} className="sort-column-item">
                      <div className="sort-column-controls">
                        <button
                          className="sort-move-button"
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          type="button"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          className="sort-move-button"
                          onClick={() => handleMoveDown(index)}
                          disabled={index === pendingColumns.length - 1}
                          type="button"
                          title="Move down"
                        >
                          ↓
                        </button>
                      </div>
                      <div className="sort-column-info">
                        <span className="sort-column-label">
                          {index + 1}. {getColumnLabel(column)}
                        </span>
                        <select
                          className="sort-direction-select"
                          value={pendingDirections[index] || 'asc'}
                          onChange={(e) => handleDirectionChange(index, e.target.value)}
                        >
                          <option value="asc">Ascending</option>
                          <option value="desc">Descending</option>
                        </select>
                      </div>
                      <button
                        className="sort-remove-button"
                        onClick={() => handleRemoveColumn(index)}
                        type="button"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {getAvailableColumns().length > 0 && (
                <div className="add-sort-column">
                  <label className="add-sort-label">Add Sort Column:</label>
                  <select
                    className="add-sort-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddColumn(e.target.value);
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="">Select a column...</option>
                    {getAvailableColumns().map(col => (
                      <option key={col.value} value={col.value}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pendingColumns.length > 0 && (
                <button
                  className="clear-sort-button"
                  onClick={handleClearAll}
                  type="button"
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="multi-column-sort-footer">
              <button
                className="cancel-sort-button"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="apply-sort-button"
                onClick={handleApply}
                type="button"
                disabled={!hasChanges()}
              >
                Apply
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MultiColumnSort;

