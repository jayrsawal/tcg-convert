import React from 'react';
import './SidebarCardList.css';

/**
 * Shared component for rendering card lists in sidebars
 * Used by both DeckBuilderPage and ProductsPage
 */
const SidebarCardList = ({
  items, // Array of { product, productId, quantity, changeStatus? }
  getProductAttributes,
  getColorBrightness,
  productPrices,
  formatCurrency,
  maxPercentage,
  onAddClick,
  onRemoveClick,
  canEdit = false,
  emptyMessage = 'No items'
}) => {
  if (items.length === 0) {
    return (
      <div className="sidebar-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="deck-cards-list">
      {items.map(({ product, productId, quantity, changeStatus }) => {
        const name = product.name || 'Unknown';
        const imageUrl = product.image_url || product.imageUrl;
        const attributes = getProductAttributes(productId, product);
        
        return (
          <div 
            key={productId} 
            className={`deck-card-item ${changeStatus && changeStatus !== 'unchanged' ? `staged-${changeStatus}` : ''}`}
          >
            {/* Section 1: Level and Cost */}
            <div className="deck-card-level-cost">
              {attributes.level && (() => {
                const brightness = attributes.color ? getColorBrightness(attributes.color) : 'dark';
                const textColor = brightness === 'light' ? '#718096' : (attributes.color || '#4a5568');
                return (
                  <div 
                    className="deck-card-level"
                    style={{ color: textColor }}
                  >
                    Lv. {attributes.level}
                  </div>
                );
              })()}
              {attributes.cost !== null && attributes.cost !== undefined && (() => {
                const brightness = attributes.color ? getColorBrightness(attributes.color) : 'dark';
                const textColor = brightness === 'light' ? '#718096' : (attributes.color || '#667eea');
                return (
                  <div className="deck-card-cost-section">
                    <div 
                      className="deck-card-cost-value"
                      style={{ color: textColor }}
                    >
                      {attributes.cost}
                    </div>
                    <div 
                      className="deck-card-cost-label"
                      style={{ color: textColor }}
                    >
                      cost
                    </div>
                  </div>
                );
              })()}
            </div>
            
            {/* Section 2: Card Thumbnail */}
            <div className="deck-card-thumbnail">
              {imageUrl ? (
                <img 
                  src={imageUrl} 
                  alt={name}
                  className="deck-card-thumbnail-image"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextSibling) {
                      e.target.nextSibling.style.display = 'flex';
                    }
                  }}
                />
              ) : null}
              <div className="deck-card-thumbnail-placeholder" style={{ display: imageUrl ? 'none' : 'flex' }}>
                <span>🎴</span>
              </div>
            </div>
            
            {/* Section 3: Name and Attributes */}
            <div className="deck-card-name-attributes">
              <div className="deck-card-name-row">
                <span className="deck-card-name">
                  {name}
                  {(attributes.attackPoints || attributes.hitPoints) && (
                    <span className="deck-card-stats">
                      {attributes.attackPoints && <span> {attributes.attackPoints}</span>}
                      {attributes.attackPoints && attributes.hitPoints && <span className="deck-card-stats-separator"> | </span>}
                      {attributes.hitPoints && <span>{attributes.hitPoints}</span>}
                    </span>
                  )}
                </span>
              </div>
              <div className="deck-card-tags-row">
                {attributes.cardType && (() => {
                  const brightness = attributes.color ? getColorBrightness(attributes.color) : 'dark';
                  const textColor = brightness === 'light' ? '#1f2937' : '#ffffff';
                  const textShadow = brightness === 'light' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.2)';
                  const borderStyle = brightness === 'light' ? { border: '1px solid #718096' } : {};
                  return (
                    <div className="deck-card-tags">
                      <span 
                        className="deck-card-tag"
                        style={attributes.color ? { 
                          backgroundColor: attributes.color,
                          color: textColor,
                          textShadow: textShadow,
                          ...borderStyle
                        } : {}}
                      >
                        {attributes.cardType}
                      </span>
                    </div>
                  );
                })()}
                {(() => {
                  const price = productPrices[parseInt(productId, 10)];
                  const marketPrice = price?.market_price || price?.marketPrice;
                  if (marketPrice !== null && marketPrice !== undefined) {
                    const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
                    if (!isNaN(priceNum)) {
                      const adjustedPrice = priceNum * (maxPercentage / 100);
                      const formattedPrice = formatCurrency(adjustedPrice);
                      return (
                        <div className="deck-card-market-price">
                          {formattedPrice}
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
              </div>
            </div>
            
            {/* Section 4: Quantity and Buttons */}
            <div className="deck-card-quantity-controls">
              <div className="deck-card-quantity">{quantity}x</div>
              {canEdit && onAddClick && onRemoveClick && (
                <div className="deck-card-buttons">
                  <button
                    className="deck-card-add-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddClick(e, productId);
                    }}
                    title="Add one"
                  >
                    +
                  </button>
                  <button
                    className="deck-card-remove-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveClick(e, productId);
                    }}
                    title="Remove one"
                  >
                    −
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SidebarCardList;

