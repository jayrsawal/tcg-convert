import React from 'react';
import './DeckDeltaConfirmation.css';

/**
 * DeckDeltaConfirmation component - Shows a summary of deck changes before applying
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {Function} props.onConfirm - Callback when user confirms
 * @param {Function} props.onDiscard - Callback when user discards changes
 * @param {Object} props.addedItems - Map of productId to quantity for new cards
 * @param {Object} props.updatedItems - Map of productId to {oldQuantity, newQuantity} for updated cards
 * @param {Array} props.removedItems - Array of productIds being removed
 * @param {Object} props.products - Map of productId to product object for displaying names
 */
const DeckDeltaConfirmation = ({
  isOpen,
  onClose,
  onConfirm,
  onDiscard,
  addedItems = {},
  updatedItems = {},
  removedItems = [],
  products = {}
}) => {
  if (!isOpen) return null;

  const addedCount = Object.keys(addedItems).length;
  const updatedCount = Object.keys(updatedItems).length;
  const removedCount = removedItems.length;
  const hasChanges = addedCount > 0 || updatedCount > 0 || removedCount > 0;

  const getProductName = (productId) => {
    const product = products[productId] || products[parseInt(productId, 10)];
    return product?.name || `Card ${productId}`;
  };

  return (
    <>
      <div className="deck-delta-overlay" onClick={onClose} />
      <div className="deck-delta-dialog">
        <div className="deck-delta-header">
          <h3 className="deck-delta-title">Confirm Deck Changes</h3>
          <button className="deck-delta-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        
        <div className="deck-delta-content">
          {!hasChanges ? (
            <p className="deck-delta-intro">No changes to apply.</p>
          ) : (
            <>
              <p className="deck-delta-intro">
                Review the changes below before applying them to your deck:
              </p>

              {/* Adding Section */}
              {addedCount > 0 && (
                <div className="deck-delta-section">
                  <h4 className="delta-section-title">Adding Cards ({addedCount})</h4>
                  <ul className="delta-list">
                    {Object.entries(addedItems).map(([productId, quantity]) => (
                      <li key={productId}>
                        <span className="delta-item-name">{getProductName(productId)}</span>
                        <span className="delta-item-quantity">+{quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Updating Section */}
              {updatedCount > 0 && (
                <div className="deck-delta-section">
                  <h4 className="delta-section-title">Updating Quantities ({updatedCount})</h4>
                  <ul className="delta-list">
                    {Object.entries(updatedItems).map(([productId, { oldQuantity, newQuantity }]) => (
                      <li key={productId}>
                        <span className="delta-item-name">{getProductName(productId)}</span>
                        <span className="delta-item-quantity">
                          {oldQuantity} → {newQuantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Removing Section */}
              {removedCount > 0 && (
                <div className="deck-delta-section">
                  <h4 className="delta-section-title">Removing Cards ({removedCount})</h4>
                  <ul className="delta-list">
                    {removedItems.map((productId) => (
                      <li key={productId}>
                        <span className="delta-item-name">{getProductName(productId)}</span>
                        <span className="delta-item-quantity">Remove</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="deck-delta-actions">
          <div className="deck-delta-actions-left">
            {onDiscard && (
              <button
                className="deck-delta-discard"
                onClick={onDiscard}
                disabled={!hasChanges}
              >
                Discard Changes
              </button>
            )}
          </div>
          <div className="deck-delta-actions-right">
            <button
              className="deck-delta-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="deck-delta-confirm"
              onClick={onConfirm}
              disabled={!hasChanges}
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DeckDeltaConfirmation;

