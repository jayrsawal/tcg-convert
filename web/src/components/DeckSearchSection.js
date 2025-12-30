import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAllDeckLists, filterProducts, extractExtendedDataFromProduct, fetchCurrentPricesBulk, fetchCategoryRules } from '../lib/api';
import './DeckListsPage.css';

const DeckSearchSection = ({ categoryId = 86, currentUserId = null }) => {
  const navigate = useNavigate();
  const [allDecks, setAllDecks] = useState([]);
  const [displayedDecks, setDisplayedDecks] = useState([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColors, setSelectedColors] = useState([]); // Array of up to 2 colors
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'wts', 'wtb', 'play'
  const [deckMetadata, setDeckMetadata] = useState({});
  const [categoryRules, setCategoryRules] = useState({});
  
  const displayedCountRef = useRef(0);
  const loadingDecksRef = useRef(false);
  const sentinelRef = useRef(null);
  const itemsPerPage = 20; // Number of decks to show per "page" in infinite scroll

  // Load category rules
  useEffect(() => {
    const loadCategoryRules = async () => {
      if (!categoryId) return;
      try {
        const rulesData = await fetchCategoryRules();
        const rulesMap = {};
        rulesData.forEach(rule => {
          const catId = String(rule.category_id || rule.categoryId || rule.id);
          rulesMap[catId] = rule;
        });
        const categoryRule = rulesMap[String(categoryId)] || {};
        setCategoryRules(categoryRule);
      } catch (err) {
        console.error('Error loading category rules:', err);
        setCategoryRules({});
      }
    };
    loadCategoryRules();
  }, [categoryId]);

  // Load deck metadata (colors, market value, etc.)
  const loadDeckMetadata = useCallback(async (decks) => {
    if (!decks || decks.length === 0) return;
    
    const metadataMap = {};
    
    // First pass: collect all product IDs from all decks
    const allProductIdsSet = new Set();
    const deckProductMap = {}; // Map deckId to its product IDs
    
    for (const deck of decks) {
      const deckId = deck.deck_list_id || deck.id;
      if (!deck.items || typeof deck.items !== 'object') {
        metadataMap[deckId] = { colorCounts: {}, marketValue: 0, backgroundImage: null };
        continue;
      }
      
      const productIds = Object.keys(deck.items)
        .filter(id => deck.items[id] > 0)
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
      
      deckProductMap[deckId] = productIds;
      productIds.forEach(id => allProductIdsSet.add(id));
    }
    
    if (allProductIdsSet.size === 0) {
      // No products in any deck, set empty metadata
      decks.forEach(deck => {
        const deckId = deck.deck_list_id || deck.id;
        metadataMap[deckId] = { colorCounts: {}, marketValue: 0, backgroundImage: null };
      });
      setDeckMetadata(metadataMap);
      return;
    }
    
    // Fetch all products in batches
    const allProductIds = Array.from(allProductIdsSet);
    const batches = [];
    for (let i = 0; i < allProductIds.length; i += 1000) {
      batches.push(allProductIds.slice(i, i + 1000));
    }
    
    const allProducts = [];
    for (const batch of batches) {
      try {
        const response = await filterProducts({
          category_id: categoryId,
          product_ids: batch,
          page: 1,
          limit: 1000
        });
        
        let productsData = [];
        if (response && typeof response === 'object') {
          if (response.data && Array.isArray(response.data)) {
            productsData = response.data;
          } else if (response.products && Array.isArray(response.products)) {
            productsData = response.products;
          } else if (Array.isArray(response)) {
            productsData = response;
          }
        }
        allProducts.push(...productsData);
      } catch (err) {
        console.error('Error fetching products for metadata:', err);
      }
    }
    
    // Create a map of product_id to product
    const productMap = {};
    allProducts.forEach(product => {
      const productId = product.product_id || product.id;
      if (productId) {
        productMap[productId] = product;
      }
    });
    
    // Fetch prices for all products
    const productIdsForPricing = allProducts
      .map(p => p.product_id || p.id)
      .filter(id => id !== undefined && id !== null);
    
    let pricesMap = {};
    if (productIdsForPricing.length > 0) {
      try {
        pricesMap = await fetchCurrentPricesBulk(productIdsForPricing);
      } catch (err) {
        console.error('Error fetching prices for metadata:', err);
      }
    }
    
    // Second pass: calculate metadata for each deck
    for (const deck of decks) {
      const deckId = deck.deck_list_id || deck.id;
      const productIds = deckProductMap[deckId] || [];
      
      const colorCounts = {};
      let marketValue = 0;
      let backgroundImage = null;
      
      for (const productId of productIds) {
        const product = productMap[productId];
        if (!product) continue;
        
        const quantity = deck.items[productId] || 0;
        if (quantity <= 0) continue;
        
        // Extract extended data
        const extendedData = extractExtendedDataFromProduct(product);
        const colorEntry = extendedData.find(item => {
          const key = (item.key || item.name || '').toUpperCase();
          return key === 'COLOR';
        });
        
        if (colorEntry) {
          const color = (colorEntry.value || colorEntry.val || '').toUpperCase();
          if (color) {
            colorCounts[color] = (colorCounts[color] || 0) + quantity;
          }
        }
        
        // Calculate market value
        const price = pricesMap[productId];
        const marketPrice = price?.market_price || price?.marketPrice;
        if (marketPrice !== null && marketPrice !== undefined) {
          const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
          if (!isNaN(priceNum)) {
            marketValue += priceNum * quantity;
          }
        }
        
        // Get background image (first product with image)
        if (!backgroundImage && product.image_url) {
          backgroundImage = product.image_url;
        }
      }
      
      metadataMap[deckId] = {
        colorCounts,
        marketValue,
        backgroundImage
      };
    }
    
    setDeckMetadata(metadataMap);
  }, [categoryId]);

  // Load all decks
  const loadAllDecks = useCallback(async () => {
    if (loadingDecksRef.current) return;
    loadingDecksRef.current = true;
    
    try {
      setLoadingDecks(true);
      const allDecksData = await fetchAllDeckLists(categoryId);
      
      // Filter out private decks that don't belong to the current user
      const publicDecks = allDecksData.filter(deck => {
        // If deck is private, only show it if it belongs to the current user
        if (deck.private && currentUserId) {
          return (deck.user_id || deck.userId) === currentUserId;
        }
        // Show all public decks
        return !deck.private;
      });
      
      // Filter out current user's decks (they're already shown in "My Deck Lists")
      const filteredDecks = currentUserId 
        ? publicDecks.filter(deck => (deck.user_id || deck.userId) !== currentUserId)
        : publicDecks;
      
      // Sort by creation date (most recent first)
      const sortedDecks = [...filteredDecks].sort((a, b) => {
        const aDate = a.created_at || a.created_at_timestamp || a.timestamp || a.created || a.date_created || 0;
        const bDate = b.created_at || b.created_at_timestamp || b.timestamp || b.created || b.date_created || 0;
        const aTime = typeof aDate === 'string' ? new Date(aDate).getTime() : (aDate || 0);
        const bTime = typeof bDate === 'string' ? new Date(bDate).getTime() : (bDate || 0);
        return bTime - aTime;
      });
      
      setAllDecks(sortedDecks);
      displayedCountRef.current = 0;
      setDisplayedDecks([]);
      setHasMore(sortedDecks.length > 0);
      
      // Load metadata for all decks
      await loadDeckMetadata(sortedDecks);
    } catch (err) {
      console.error('Error loading all deck lists:', err);
    } finally {
      setLoadingDecks(false);
      loadingDecksRef.current = false;
    }
  }, [categoryId, currentUserId, loadDeckMetadata]);

  // Load more decks (infinite scroll)
  const loadMoreDecks = useCallback(() => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    
    // Simulate loading delay for better UX
    setTimeout(() => {
      const currentCount = displayedCountRef.current;
      const nextBatch = allDecks.slice(currentCount, currentCount + itemsPerPage);
      
      if (nextBatch.length > 0) {
        setDisplayedDecks(prev => [...prev, ...nextBatch]);
        displayedCountRef.current = currentCount + nextBatch.length;
        setHasMore(displayedCountRef.current < allDecks.length);
      } else {
        setHasMore(false);
      }
      
      setLoadingMore(false);
    }, 100);
  }, [allDecks, loadingMore, hasMore]);

  // Filter decks by search query, colors, and status
  const filteredDecks = React.useMemo(() => {
    let filtered = displayedDecks;
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(deck => {
        const name = (deck.name || '').toLowerCase();
        const username = (deck.username || '').toLowerCase();
        return name.includes(query) || username.includes(query);
      });
    }
    
    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(deck => {
        if (statusFilter === 'wts') return deck.selling === true;
        if (statusFilter === 'wtb') return deck.buying === true;
        if (statusFilter === 'play') return !deck.selling && !deck.buying;
        return true;
      });
    }
    
    // Filter by colors (deck must contain ALL selected colors - AND operation)
    if (selectedColors.length > 0) {
      filtered = filtered.filter(deck => {
        const deckId = deck.deck_list_id || deck.id;
        const metadata = deckMetadata[deckId] || {};
        const colorCounts = metadata.colorCounts || {};
        const deckColors = Object.keys(colorCounts).map(c => c.toLowerCase());
        
        // Check if deck has ALL of the selected colors
        return selectedColors.every(selectedColor => 
          deckColors.includes(selectedColor.toLowerCase())
        );
      });
    }
    
    return filtered;
  }, [displayedDecks, searchQuery, statusFilter, selectedColors, deckMetadata]);

  // Initial load
  useEffect(() => {
    loadAllDecks();
  }, [loadAllDecks]);

  // Infinite scroll observer
  useEffect(() => {
    if (!hasMore || loadingMore || loadingDecks) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreDecks();
        }
      },
      { threshold: 0.1 }
    );
    
    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }
    
    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
      }
    };
  }, [hasMore, loadingMore, loadingDecks, loadMoreDecks]);

  // Load initial batch when allDecks changes
  useEffect(() => {
    if (allDecks.length > 0 && displayedDecks.length === 0) {
      const initialBatch = allDecks.slice(0, itemsPerPage);
      setDisplayedDecks(initialBatch);
      displayedCountRef.current = initialBatch.length;
      setHasMore(initialBatch.length < allDecks.length);
    }
  }, [allDecks]);

  const handleDeckClick = (deckId) => {
    navigate(`/deck-builder/${deckId}`);
  };

  // Convert color name/text to CSS color value
  const getColorValue = (colorText) => {
    if (!colorText) return null;
    
    const color = colorText.trim().toLowerCase();
    
    if (/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
      return color;
    }
    
    // First try to get from category rules
    if (categoryRules?.colors) {
      // Try exact match (case-insensitive)
      const colorKey = Object.keys(categoryRules.colors).find(
        key => key.toLowerCase() === color
      );
      if (colorKey && categoryRules.colors[colorKey]?.hex) {
        return categoryRules.colors[colorKey].hex;
      }
    }
    
    // Fallback color map
    const colorMap = {
      'red': '#ef4444',
      'blue': '#3b82f6',
      'green': '#10b981',
      'yellow': '#fbbf24',
      'orange': '#f97316',
      'purple': '#a855f7',
      'pink': '#ec4899',
      'black': '#1f2937',
      'white': '#ffffff',
      'gray': '#6b7280',
      'grey': '#6b7280',
      'brown': '#92400e',
      'cyan': '#06b6d4',
      'magenta': '#d946ef',
    };
    
    return colorMap[color] || null;
  };

  const getColorBrightness = (color) => {
    if (!categoryRules || !categoryRules.colors) return 0.5;
    const colorRule = categoryRules.colors[color];
    if (!colorRule || !colorRule.hex) return 0.5;
    
    const hex = colorRule.hex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness / 255;
  };

  // Get available colors from category rules or extract from deck metadata
  const availableColors = React.useMemo(() => {
    // First try to get from category rules
    if (categoryRules?.colors && Object.keys(categoryRules.colors).length > 0) {
      return Object.keys(categoryRules.colors).sort();
    }
    
    // Fallback: extract unique colors from all loaded decks' metadata
    const colorSet = new Set();
    Object.values(deckMetadata).forEach(metadata => {
      if (metadata.colorCounts) {
        Object.keys(metadata.colorCounts).forEach(color => {
          // Normalize color name (keep original case but add to set)
          colorSet.add(color);
        });
      }
    });
    
    // Also check allDecks for color_1 and color_2 fields
    allDecks.forEach(deck => {
      if (deck.color_1) {
        const color1 = deck.color_1.split('-')[0]; // Extract color name before the count
        if (color1) colorSet.add(color1);
      }
      if (deck.color_2) {
        const color2 = deck.color_2.split('-')[0]; // Extract color name before the count
        if (color2) colorSet.add(color2);
      }
    });
    
    if (colorSet.size > 0) {
      return Array.from(colorSet).sort();
    }
    
    // Final fallback: common color names
    return ['Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Black', 'White', 'Gray', 'Brown', 'Cyan', 'Magenta'].sort();
  }, [categoryRules, deckMetadata, allDecks]);

  // Handle color selection (max 2) - click to toggle
  const handleColorToggle = (color) => {
    setSelectedColors(prev => {
      if (prev.includes(color)) {
        return prev.filter(c => c !== color);
      } else if (prev.length < 2) {
        return [...prev, color];
      }
      return prev; // Already at max
    });
  };

  return (
    <div className="deck-search-section">
      <div className="deck-search-header">
        <h3 className="section-title">Browse All Decks</h3>
        <div className="deck-search-controls">
          <input
            type="text"
            className="deck-search-input"
            placeholder="Search decks by name or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="deck-search-filters">
        {/* Color Filters */}
        <div className="deck-filter-group">
          <label className="deck-filter-label">Colors (up to 2):</label>
          <div className="deck-color-filters">
            {availableColors.map(color => {
              const isSelected = selectedColors.includes(color);
              const colorRule = categoryRules?.colors?.[color];
              const colorHex = colorRule?.hex || getColorValue(color) || '#888';
              const isDisabled = !isSelected && selectedColors.length >= 2;
              
              return (
                <div
                  key={color}
                  className={`deck-color-filter-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                  onClick={() => !isDisabled && handleColorToggle(color)}
                  style={{
                    '--color-hex': colorHex,
                    cursor: isDisabled ? 'not-allowed' : 'pointer'
                  }}
                >
                  <span 
                    className="deck-color-filter-color"
                    style={{ backgroundColor: colorHex }}
                  />
                  <span className="deck-color-filter-name">{color}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Status Filter */}
        <div className="deck-filter-group">
          <label className="deck-filter-label">Status:</label>
          <div className="deck-status-filters">
            <div
              className={`deck-status-filter-item ${statusFilter === 'all' ? 'selected' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              <span>All</span>
            </div>
            <div
              className={`deck-status-filter-item ${statusFilter === 'wts' ? 'selected' : ''}`}
              onClick={() => setStatusFilter('wts')}
            >
              <span>WTS</span>
            </div>
            <div
              className={`deck-status-filter-item ${statusFilter === 'wtb' ? 'selected' : ''}`}
              onClick={() => setStatusFilter('wtb')}
            >
              <span>WTB</span>
            </div>
            <div
              className={`deck-status-filter-item ${statusFilter === 'play' ? 'selected' : ''}`}
              onClick={() => setStatusFilter('play')}
            >
              <span>Play</span>
            </div>
          </div>
        </div>
      </div>

      {loadingDecks ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading decks...</p>
        </div>
      ) : filteredDecks.length === 0 ? (
        <div className="empty-state">
          <p>
            {searchQuery || selectedColors.length > 0 || statusFilter !== 'all'
              ? 'No decks found matching your filters.'
              : 'No decks available.'}
          </p>
        </div>
      ) : (
        <>
          <div className="decks-list">
            {filteredDecks.map((deck) => {
              const deckId = deck.deck_list_id || deck.id;
              const metadata = deckMetadata[deckId] || { colorCounts: {}, marketValue: 0, backgroundImage: null };
              const colorCounts = metadata.colorCounts || {};
              const totalCards = Object.values(colorCounts).reduce((sum, count) => sum + count, 0);
              const colorEntries = Object.entries(colorCounts)
                .map(([color, count]) => ({
                  color,
                  count,
                  proportion: totalCards > 0 ? count / totalCards : 0
                }))
                .sort((a, b) => b.count - a.count);

              return (
                <div
                  key={deckId}
                  className="deck-item"
                  style={(() => {
                    const bgImage = metadata.backgroundImage;
                    if (bgImage) {
                      return {
                        backgroundImage: `url(${bgImage})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat'
                      };
                    }
                    return {};
                  })()}
                  onClick={() => handleDeckClick(deckId)}
                >
                  <div className="deck-meta-info">
                    {deck.username && (
                      <div className="deck-username">
                        @{deck.username}
                      </div>
                    )}
                    {(() => {
                      const createdDate = deck.created_at || deck.created_at_timestamp || deck.timestamp || deck.created || deck.date_created;
                      let formattedDate = '';
                      if (createdDate) {
                        try {
                          const date = typeof createdDate === 'string' ? new Date(createdDate) : new Date(createdDate * 1000);
                          if (!isNaN(date.getTime())) {
                            formattedDate = date.toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric',
                              year: 'numeric'
                            });
                          }
                        } catch (e) {}
                      }
                      return formattedDate ? (
                        <div className="deck-created-date">
                          {formattedDate}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  
                  {colorEntries.length > 0 && (
                    <div className="deck-color-pie-chart">
                      <svg className="pie-chart-svg" viewBox="0 0 100 100">
                        {(() => {
                          let currentAngle = -90;
                          return colorEntries.map(({ color, proportion }) => {
                            const colorValue = getColorValue(color);
                            const bgColor = colorValue || '#888';
                            const angle = proportion * 360;
                            const largeArc = proportion > 0.5 ? 1 : 0;
                            const x1 = 50 + 50 * Math.cos((currentAngle * Math.PI) / 180);
                            const y1 = 50 + 50 * Math.sin((currentAngle * Math.PI) / 180);
                            const x2 = 50 + 50 * Math.cos(((currentAngle + angle) * Math.PI) / 180);
                            const y2 = 50 + 50 * Math.sin(((currentAngle + angle) * Math.PI) / 180);
                            currentAngle += angle;
                            return (
                              <path
                                key={color}
                                d={`M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArc} 1 ${x2} ${y2} Z`}
                                fill={bgColor}
                                stroke="white"
                                strokeWidth="2"
                              />
                            );
                          });
                        })()}
                      </svg>
                    </div>
                  )}
                  
                  <div className="deck-info-wrapper">
                    <div className="deck-info">
                      <div className="deck-name-row">
                        <div className="deck-name">{deck.name || 'Unnamed Deck'}</div>
                      </div>
                      {/* Deck Tags */}
                      <div className="deck-tags">
                        <span className={`deck-tag deck-tag-${deck.private ? 'private' : 'public'}`}>
                          {deck.private ? 'Private' : 'Public'}
                        </span>
                        <span className={`deck-tag deck-tag-${deck.selling ? 'wts' : deck.buying ? 'wtb' : 'play'}`}>
                          {deck.selling ? 'WTS' : deck.buying ? 'WTB' : 'Play'}
                        </span>
                      </div>
                      <div className="deck-stats-row">
                        {totalCards > 0 && (
                          <div className="deck-card-count">
                            {totalCards} {totalCards === 1 ? 'card' : 'cards'}
                          </div>
                        )}
                        {metadata.marketValue > 0 && (
                          <div className="deck-market-value">
                            ${metadata.marketValue.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {hasMore && !searchQuery && (
            <div ref={sentinelRef} className="infinite-scroll-sentinel">
              {loadingMore && (
                <div className="loading-more">
                  <div className="spinner"></div>
                  <p>Loading more decks...</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DeckSearchSection;

