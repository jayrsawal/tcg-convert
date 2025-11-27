import React, { useEffect, useRef, useState } from 'react';
import './ProductListingContent.css';

/**
 * Shared ProductListingContent component for displaying products with filters and controls
 * Used by both DeckBuilderPage and ProductsPage
 */
const ProductListingContent = ({
  // State props
  searchQuery,
  setSearchQuery,
  sortOption,
  setSortOption,
  showFavoritesOnly,
  setShowFavoritesOnly,
  showOwnedOnly,
  setShowOwnedOnly,
  showInDeckOnly,
  setShowInDeckOnly,
  selectedGroupId,
  setSelectedGroupId,
  attributeFilters,
  pendingAttributeFilters,
  setPendingAttributeFilters,
  attributeValues,
  categoryKeys,
  showAttributeFilters,
  setShowAttributeFilters,
  collapsedAttributeGroups,
  setCollapsedAttributeGroups,
  
  // Data props
  products,
  filteredProducts,
  groups,
  loading,
  loadingGroups,
  loadingAttributes,
  loadingMore,
  error,
  currentPage,
  totalCount,
  hasMorePages,
  onLoadMore,
  newlyAddedProductIds = new Set(),
  
  // User and permissions
  user,
  canEdit = false,
  
  // Product rendering props
  getQuantity,
  getRarity,
  formatCurrency,
  productPrices,
  maxPercentage,
  favorites,
  
  // Event handlers
  onProductClick,
  onFavoriteToggle,
  onAddToDeck,
  onRemoveFromDeck,
  handleGroupFilter,
  handleAttributeFilter,
  handleApplyAttributeFilters,
  handleClearPendingFilters,
  toggleAttributeGroup,
  
  // Custom render props
  renderProductCardActions,
  productCardClassName,
  renderProductCardBadges,
  renderFavoriteButton,
  productsGridRef,
  productsGridStyle,
  productsGridWrapperStyle,
  getProductImageSrc,
  renderWatermark,
}) => {
  // Local state for search input (to avoid triggering search on every keystroke)
  const [searchInputValue, setSearchInputValue] = useState(searchQuery || '');

  // Sync local state with prop when it changes externally
  useEffect(() => {
    setSearchInputValue(searchQuery || '');
  }, [searchQuery]);

  const handleSearchInputChange = (e) => {
    setSearchInputValue(e.target.value);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      setSearchQuery(searchInputValue.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchInputValue('');
    setSearchQuery('');
  };

  const handleSortChange = (e) => {
    setSortOption(e.target.value);
  };

  const handleToggleAttributeFilters = () => {
    if (!showAttributeFilters) {
      // Initialize pending filters from current filters when opening
      setPendingAttributeFilters(attributeFilters);
    }
    setShowAttributeFilters(!showAttributeFilters);
  };

  const totalSelectedFilters = Object.values(attributeFilters).reduce((sum, arr) => {
    return sum + (Array.isArray(arr) ? arr.length : (arr ? 1 : 0));
  }, 0);

  // Infinite scroll with Intersection Observer
  const sentinelRef = useRef(null);
  const hasScrolledRef = useRef(false);
  const isInitialMountRef = useRef(true);

  // Track if user has scrolled
  useEffect(() => {
    const handleScroll = () => {
      hasScrolledRef.current = true;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    if (!hasMorePages) {
      return;
    }
    if (!onLoadMore) {
      return;
    }
    // Don't trigger loading if we have no filtered products (all filtered out)
    // This prevents infinite loading when filters exclude all products
    if (filteredProducts.length === 0 && products.length > 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !loadingMore && hasMorePages) {
          // On initial mount, if sentinel is already visible, wait for user to scroll
          // This prevents auto-loading page 2 immediately on page load
          if (isInitialMountRef.current && !hasScrolledRef.current) {
            // Mark that we've seen the initial intersection, but don't load yet
            return;
          }
          
          // Only load if we have filtered products or no products at all
          if (filteredProducts.length > 0 || products.length === 0) {
            onLoadMore();
          }
        }
      },
      {
        root: null,
        rootMargin: '100px', // Start loading 100px before reaching the sentinel
        threshold: 0.01 // Trigger even if just 1% is visible
      }
    );

    observer.observe(sentinel);
    
    // Mark that initial mount is complete after a brief delay
    // This allows the observer to check if sentinel is initially visible
    const mountTimeout = setTimeout(() => {
      isInitialMountRef.current = false;
    }, 100);

    return () => {
      clearTimeout(mountTimeout);
      if (sentinel) {
        observer.unobserve(sentinel);
      }
    };
  }, [hasMorePages, loadingMore, onLoadMore, products.length, filteredProducts.length]);
  
  // Reset flags when products change significantly (new search/filter/category)
  // Use a stable key based on product counts to detect significant changes
  const productChangeKey = filteredProducts.length === 0 ? products.length : filteredProducts.length;
  useEffect(() => {
    isInitialMountRef.current = true;
    hasScrolledRef.current = false;
  }, [productChangeKey]);

  return (
    <div className="products-container">
      <div className="products-header-section">
        {/* Controls Section */}
        <div className="products-controls">
          {/* Search Input */}
          <div className="search-control">
            <label htmlFor="product-search" className="control-label">Search:</label>
            <div className="search-input-container">
              <input
                type="text"
                id="product-search"
                className="search-input"
                placeholder="Search by name... (Press Enter)"
                value={searchInputValue}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
              />
              {searchInputValue && (
                <button
                  type="button"
                  className="search-clear-button"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
          
          {/* Favorites Filters - Compact inline */}
          {user && (
            <div className="favorites-filters-compact">
              <label className="favorites-filter-label-compact">
                <input
                  type="checkbox"
                  checked={showFavoritesOnly}
                  onChange={(e) => setShowFavoritesOnly(e.target.checked)}
                  className="favorites-checkbox"
                />
                <span>Favorites</span>
              </label>
              <label className="favorites-filter-label-compact">
                <input
                  type="checkbox"
                  checked={showOwnedOnly}
                  onChange={(e) => setShowOwnedOnly(e.target.checked)}
                  className="favorites-checkbox"
                />
                <span>Owned</span>
              </label>
              {/* Only show "Show In Deck Only" filter in edit mode */}
              {canEdit && showInDeckOnly !== undefined && (
                <label className="favorites-filter-label-compact">
                  <input
                    type="checkbox"
                    checked={showInDeckOnly}
                    onChange={(e) => setShowInDeckOnly(e.target.checked)}
                    className="favorites-checkbox"
                  />
                  <span>In Deck</span>
                </label>
              )}
            </div>
          )}

          {/* Group Filter */}
          {!loadingGroups && groups.length > 0 && (
            <div className="group-filter">
              <label htmlFor="group-filter-select" className="control-label">Filter by Release:</label>
              <select
                id="group-filter-select"
                className="group-filter-select"
                value={selectedGroupId || ''}
                onChange={(e) => handleGroupFilter ? handleGroupFilter(e.target.value === '' ? null : parseInt(e.target.value)) : setSelectedGroupId(e.target.value === '' ? null : parseInt(e.target.value))}
              >
                <option value="">All Releases</option>
                {groups.map((group) => {
                  const groupId = group.group_id || group.groupId || group.id;
                  const groupName = group.name || `Group ${groupId}`;
                  return (
                    <option key={groupId} value={groupId}>{groupName}</option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Sort Dropdown */}
          <div className="sort-control">
            <label htmlFor="sort-select" className="control-label">Sort:</label>
            <select
              id="sort-select"
              className="sort-select"
              value={sortOption}
              onChange={handleSortChange}
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
            </select>
          </div>

          {/* Attribute Filters Button */}
          {(categoryKeys.length > 0 || loadingAttributes) && (
            <div className="attribute-filter-control">
              <label className="control-label">More Filters:</label>
              <button
                className="attribute-filters-toggle"
                onClick={handleToggleAttributeFilters}
                disabled={loadingAttributes || categoryKeys.length === 0}
                title={loadingAttributes ? 'Loading attributes...' : categoryKeys.length === 0 ? 'No attributes available' : 'Filter by attributes'}
              >
                <span className="filter-icon">🔍</span>
                <span>Attributes</span>
                {loadingAttributes && <span className="loading-indicator">...</span>}
                {!loadingAttributes && categoryKeys.length > 0 && totalSelectedFilters > 0 && (
                  <span className="active-filters-badge">{totalSelectedFilters}</span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Attribute Filters Panel */}
        {categoryKeys.length > 0 && showAttributeFilters && (
          <>
            <div 
              className="attribute-filters-overlay"
              onClick={() => setShowAttributeFilters(false)}
            />
            <div className="attribute-filters-panel">
              <div className="attribute-filters-panel-header">
                <h3 className="filters-panel-title">Filter by Attributes</h3>
                <div className="filters-header-actions">
                  <button
                    className="close-filters-button"
                    onClick={() => setShowAttributeFilters(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="attribute-filters-panel-content">
                {loadingAttributes ? (
                  <div className="attributes-loading">
                    <span className="loading-text">Loading attribute filters...</span>
                  </div>
                ) : (
                  <div className="attribute-filters-list">
                    {categoryKeys.length === 0 ? (
                      <div className="no-attributes-message">
                        <p>No attributes available for this category.</p>
                      </div>
                    ) : (
                      categoryKeys.map((key) => {
                        const values = attributeValues[key] || [];
                        if (values.length === 0) return null;
                        
                        const selectedValues = Array.isArray(pendingAttributeFilters[key]) 
                          ? pendingAttributeFilters[key] 
                          : (pendingAttributeFilters[key] ? [pendingAttributeFilters[key]] : []);
                        
                        const isCollapsed = collapsedAttributeGroups[key] !== false; // Default to collapsed
                        
                        return (
                          <div key={key} className="attribute-filter-group">
                            <div 
                              className="attribute-filter-group-header"
                              onClick={() => toggleAttributeGroup ? toggleAttributeGroup(key) : setCollapsedAttributeGroups(prev => ({ ...prev, [key]: !prev[key] }))}
                            >
                              <button 
                                className="attribute-group-toggle"
                                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                              >
                                {isCollapsed ? '▶' : '▼'}
                              </button>
                              <label className="attribute-filter-group-label">{key}:</label>
                              {selectedValues.length > 0 && (
                                <span className="attribute-group-count">({selectedValues.length})</span>
                              )}
                            </div>
                            {!isCollapsed && (
                              <div className="attribute-filter-checkboxes">
                                {values.map((value) => {
                                  const isChecked = selectedValues.includes(value);
                                  return (
                                    <label 
                                      key={value} 
                                      className="attribute-filter-checkbox-label"
                                      htmlFor={`attr-filter-${key}-${value}`}
                                    >
                                      <input
                                        type="checkbox"
                                        id={`attr-filter-${key}-${value}`}
                                        className="attribute-filter-checkbox"
                                        checked={isChecked}
                                        onChange={() => handleAttributeFilter(key, value)}
                                      />
                                      <span className="checkbox-text">{value}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              <div className="attribute-filters-panel-footer">
                {Object.keys(pendingAttributeFilters).length > 0 && (
                  <button
                    className="clear-filters-button-footer"
                    onClick={handleClearPendingFilters}
                    aria-label="Clear all pending filters"
                  >
                    Clear All
                  </button>
                )}
                <button
                  className="apply-filters-button"
                  onClick={handleApplyAttributeFilters}
                  disabled={Object.keys(pendingAttributeFilters).length === 0}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Loading State - only show when initially loading, not when loading more */}
      {loading && products.length === 0 && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading products...</p>
        </div>
      )}

      {/* Error State */}
      {error && products.length === 0 && (
        <div className="error-state">
          <p className="error-message">⚠️ {error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredProducts.length === 0 && products.length === 0 && (
        <div className="empty-state">
          <p>No products available for this category.</p>
        </div>
      )}
      
      {/* No Results State */}
      {!loading && !error && products.length > 0 && filteredProducts.length === 0 && (
        <div className="empty-state">
          <p>No products match your search criteria.</p>
        </div>
      )}

      {/* Products Count Info */}
      {!loading && !error && filteredProducts.length > 0 && (
        <div className="products-count-info">
          {totalCount > 0 ? (
            <span>Showing {filteredProducts.length} of {totalCount} products</span>
          ) : (
            <span>No products match your search criteria.</span>
          )}
        </div>
      )}

      {/* Products Grid */}
      {!loading && !error && filteredProducts.length > 0 && (
        <div 
          className="products-grid-wrapper" 
          ref={productsGridRef || null}
          style={productsGridWrapperStyle || undefined}
        >
          <div className="products-grid" style={productsGridStyle || undefined}>
          {filteredProducts.map((product) => {
            const productId = product.product_id || product.id;
            const productIdStr = String(productId);
            const name = product.name || 'Unknown Product';
            const rawImageUrl = product.image_url || product.imageUrl;
            const imageUrl = typeof getProductImageSrc === 'function'
              ? getProductImageSrc(product, productIdStr, rawImageUrl)
              : rawImageUrl;
            const number = product.number || product.Number;
            const quantity = getQuantity ? getQuantity(productIdStr) : 0;
            const isFavorited = favorites && favorites.has(productIdStr);
            const rarity = getRarity ? getRarity(product) : null;
            const rarityClass = rarity ? `rarity-${rarity.toUpperCase().replace('+', 'PLUS')}` : '';
            const cardClassName = productCardClassName ? productCardClassName(product, quantity) : '';
            const isNewlyAdded = newlyAddedProductIds.has(productIdStr);
            const animationClass = isNewlyAdded ? 'product-card-new' : '';
            const finalClassName = `product-card ${cardClassName} ${rarityClass} ${animationClass}`.trim();

            return (
              <div 
                key={productId} 
                className={finalClassName}
              >
                <div className="product-image-container">
                  {imageUrl ? (
                    <img 
                      src={imageUrl} 
                      alt={name}
                      className="product-image"
                      onClick={() => onProductClick && onProductClick(productId)}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        if (e.target.nextSibling) {
                          e.target.nextSibling.style.display = 'flex';
                        }
                      }}
                    />
                  ) : (
                    <div className="product-image-placeholder">
                      <span>No Image</span>
                    </div>
                  )}
                  
                  {/* Custom actions (deck buttons, etc.) */}
                  {renderProductCardActions && renderProductCardActions(product, productId, productIdStr, quantity, isFavorited)}
                  
                  {/* Rule Violation Badges - Top Left */}
                  {renderProductCardBadges && renderProductCardBadges(product, quantity)}
                  
                  {/* Favorite Button - Bottom Left */}
                  {renderFavoriteButton && renderFavoriteButton(product, productId, productIdStr, isFavorited)}
                  
                  {/* Quantity Badge - Bottom Right */}
                  {quantity > 0 && (
                    <div className="deck-quantity-badge">
                      {quantity}x
                    </div>
                  )}
                </div>
                
                <div className="product-info">
                  {/* <div className="product-name-wrapper">
                    <h3 
                      className="product-name" 
                      onClick={() => onProductClick && onProductClick(productId)}
                    >
                      {name}
                    </h3>
                  </div> */}
                  <div className="product-number-price-row">
                    {number && <span className="product-number">#{number}</span>}
                    {(() => {
                      const price = productPrices && productPrices[parseInt(productId, 10)];
                      const marketPrice = price?.market_price || price?.marketPrice;
                      
                      if (marketPrice !== null && marketPrice !== undefined && formatCurrency) {
                        const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
                        if (!isNaN(priceNum)) {
                          const adjustedPrice = priceNum * ((maxPercentage || 100) / 100);
                          const formattedPrice = formatCurrency(adjustedPrice);
                          return (
                            <div className="product-market-price">
                              {formattedPrice}
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {renderWatermark && (
            <div className="screenshot-watermark">
              {renderWatermark(filteredProducts)}
            </div>
          )}
        </div>
      )}

      {/* Infinite Scroll Sentinel - only show if we have filtered products or no products yet */}
      {hasMorePages && (filteredProducts.length > 0 || products.length === 0) && (
        <div ref={sentinelRef} id="scroll-sentinel" className="scroll-sentinel">
          {loadingMore ? (
            <div className="loading-more">
              <div className="spinner-small"></div>
              <span>Loading more products...</span>
            </div>
          ) : (
            <div className="scroll-sentinel-placeholder"></div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductListingContent;

