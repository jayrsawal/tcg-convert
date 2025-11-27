import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isFavorited, toggleFavorite } from '../lib/favorites';
import { fetchProductById, extractExtendedDataFromProduct, fetchGroupById, fetchCurrentPrice, fetchPriceHistory, fetchVendorPrices, fetchVendorPriceHistory } from '../lib/api';
import { formatDescription } from '../lib/descriptionFormatter';
import NavigationBar from './NavigationBar';
import NotificationModal from './NotificationModal';
import './ProductCardPage.css';

const ProductCardPage = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [group, setGroup] = useState(null);
  const [extendedData, setExtendedData] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [vendorPrices, setVendorPrices] = useState([]);
  const [vendorPriceHistory, setVendorPriceHistory] = useState([]);
  const [isFavoritedState, setIsFavoritedState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPrice, setLoadingPrice] = useState(true);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState({ isOpen: false, title: '', message: '', type: 'info' });

  const loadProductData = useCallback(async () => {
    if (!productId) return;
    
    try {
      setLoading(true);
      setError(null);

      // Fetch product details
      const productData = await fetchProductById(productId);
      setProduct(productData);

      // Extract extended data from product
      const extendedDataArray = extractExtendedDataFromProduct(productData);
      setExtendedData(extendedDataArray);

      // Fetch group/release information
      const groupId = productData.group_id || productData.groupId;
      if (groupId) {
        try {
          const groupData = await fetchGroupById(groupId);
          setGroup(groupData);
        } catch (err) {
          console.warn('Could not fetch group data:', err);
          setGroup(null);
        }
      }

      // Fetch pricing information (non-blocking)
      loadPricingData(productId);
      
      // Check if product is favorited (non-blocking)
      if (user) {
        checkFavoriteStatus(productId);
      }
    } catch (err) {
      setError(err.message || 'Failed to load product');
      console.error('Error loading product:', err);
    } finally {
      setLoading(false);
    }
  }, [productId, user]);

  useEffect(() => {
    if (productId) {
      loadProductData();
    }
  }, [productId, loadProductData]);

  // Update favorite status when user changes
  useEffect(() => {
    if (productId && user) {
      checkFavoriteStatus(productId);
    } else {
      setIsFavoritedState(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, productId]);


  const loadPricingData = async (productId) => {
    try {
      setLoadingPrice(true);
      
      // Fetch current price, price history, vendor prices, and vendor price history in parallel
      const [price, history, vendorPricesData, vendorHistory] = await Promise.all([
        fetchCurrentPrice(productId),
        fetchPriceHistory(productId),
        fetchVendorPrices(productId),
        fetchVendorPriceHistory(productId)
      ]);
      
      setCurrentPrice(price);
      // Sort history by date (oldest first) for chart display
      const sortedHistory = Array.isArray(history) 
        ? history.sort((a, b) => {
            const dateA = new Date(a.fetched_at || a.fetchedAt || 0);
            const dateB = new Date(b.fetched_at || b.fetchedAt || 0);
            return dateA - dateB;
          })
        : [];
      setPriceHistory(sortedHistory);
      
      setVendorPrices(Array.isArray(vendorPricesData) ? vendorPricesData : []);
      
      // Sort vendor history by date (oldest first) for chart display
      const sortedVendorHistory = Array.isArray(vendorHistory) 
        ? vendorHistory.sort((a, b) => {
            const dateA = new Date(a.fetched_at || a.fetchedAt || a.fetched_at_timestamp || 0);
            const dateB = new Date(b.fetched_at || b.fetchedAt || b.fetched_at_timestamp || 0);
            return dateA - dateB;
          })
        : [];
      setVendorPriceHistory(sortedVendorHistory);
    } catch (err) {
      console.error('Error loading pricing data:', err);
      // Don't set error state - pricing is optional
      setCurrentPrice(null);
      setPriceHistory([]);
      setVendorPrices([]);
      setVendorPriceHistory([]);
    } finally {
      setLoadingPrice(false);
    }
  };

  const checkFavoriteStatus = async (productId) => {
    if (!user) {
      setIsFavoritedState(false);
      return;
    }
    try {
      const favorited = await isFavorited(user.id, productId);
      setIsFavoritedState(favorited);
    } catch (err) {
      console.error('Error checking favorite status:', err);
      setIsFavoritedState(false);
    }
  };

  const handleFavoriteToggle = async () => {
    if (!user) {
      // Redirect to login if not authenticated
      navigate('/login');
      return;
    }
    
    try {
      const newFavoriteStatus = await toggleFavorite(user.id, productId, isFavoritedState);
      setIsFavoritedState(newFavoriteStatus);
    } catch (err) {
      console.error('Error toggling favorite:', err);
      setNotification({
        isOpen: true,
        title: 'Error',
        message: 'Failed to update favorite. Please try again.',
        type: 'error'
      });
    }
  };

  // Helper function to map color names to hex values (similar to preview modal)
  const getColorValue = (colorText) => {
    if (!colorText) return null;
    
    const color = colorText.trim().toLowerCase();
    
    // Check if it's already a hex color
    if (/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
      return color;
    }
    
    // Common color name mappings
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
    
    return colorMap[color] || color; // Return mapped color or original if not found
  };

  // Helper function to get color brightness (similar to preview modal)
  const getColorBrightness = (colorValue) => {
    if (!colorValue) return 'dark';
    
    // Handle hex colors
    let r, g, b;
    if (colorValue.startsWith('#')) {
      const hex = colorValue.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else {
        return 'dark'; // Invalid hex
      }
    } else {
      // Try to parse as rgb/rgba
      const rgbMatch = colorValue.match(/\d+/g);
      if (rgbMatch && rgbMatch.length >= 3) {
        r = parseInt(rgbMatch[0]);
        g = parseInt(rgbMatch[1]);
        b = parseInt(rgbMatch[2]);
      } else {
        return 'dark'; // Unknown format, default to dark
      }
    }
    
    // Check if all RGB values are high (indicating white/very light color)
    // Threshold: all values must be > 240 to be considered "light" for text purposes
    return (r > 240 && g > 240 && b > 240) ? 'light' : 'dark';
  };

  // Extract special attributes (level, cost, attack points, hit points, cardType) and filter extendedData
  const { level, cost, attackPoints, hitPoints, color, cardType, filteredExtendedData, description } = useMemo(() => {
    if (!extendedData.length) {
      return { level: null, cost: null, attackPoints: null, hitPoints: null, color: null, cardType: null, filteredExtendedData: [], description: null };
    }

    let levelValue = null;
    let costValue = null;
    let attackPointsValue = null;
    let hitPointsValue = null;
    let colorValue = null;
    let cardTypeValue = null;
    let descriptionValue = null;

    const filtered = extendedData.filter((item) => {
      const key = (item.key || item.name || '').toUpperCase();
      const value = item.value || item.val;

      if (key === 'NUMBER' || key === 'NUM') {
        return false; // Filter out number
      }

      if (key === 'LEVEL') {
        levelValue = value;
        return false; // Don't show in regular attributes
      }

      if (key === 'COST') {
        // Try to parse as integer (like in sidebar)
        const costNum = parseInt(value, 10);
        costValue = !isNaN(costNum) ? costNum : value;
        return false; // Don't show in regular attributes
      }

      if (key === 'ATTACK POINTS' || key === 'ATTACKPOINTS' || key === 'ATTACK') {
        attackPointsValue = value;
        return false; // Don't show in regular attributes
      }

      if (key === 'HIT POINTS' || key === 'HITPOINTS' || key === 'HP') {
        hitPointsValue = value;
        return false; // Don't show in regular attributes
      }

      if (key === 'CARDTYPE' || key === 'CARD TYPE') {
        cardTypeValue = value;
        return false; // Don't show in regular attributes
      }

      if (key === 'COLOR') {
        colorValue = getColorValue(value);
        return true; // Keep color in attributes
      }

      if (key === 'DESCRIPTION') {
        descriptionValue = value;
        return false; // Don't show description in regular attributes (we'll show it separately)
      }

      return true; // Keep all other attributes
    });

    return {
      level: levelValue,
      cost: costValue,
      attackPoints: attackPointsValue,
      hitPoints: hitPointsValue,
      color: colorValue,
      cardType: cardTypeValue,
      filteredExtendedData: filtered,
      description: descriptionValue
    };
  }, [extendedData]);

  const traitTags = useMemo(() => {
    const tags = [];

    filteredExtendedData.forEach((item) => {
      const key = item.key || item.name || '';
      const value = item.value || item.val;

      if (!value) {
        return;
      }

      const upperKey = key.toUpperCase();
      if (upperKey === 'TRAIT' || upperKey === 'TRAITS') {
        const parentheticalMatches = value.match(/\(([^)]+)\)/g);
        if (parentheticalMatches && parentheticalMatches.length > 0) {
          parentheticalMatches.forEach(match => {
            const tag = match.replace(/[()]/g, '').trim();
            if (tag) {
              tags.push(tag);
            }
          });
        } else {
          value.split(/[,/]/).forEach(part => {
            const tag = part.replace(/[()]/g, '').trim();
            if (tag) {
              tags.push(tag);
            }
          });
        }
      }
    });

    return Array.from(new Set(tags));
  }, [filteredExtendedData]);

  // Process all filtered extended data as attributes (excluding trait entries)
  const allAttributes = filteredExtendedData
    .filter((item) => {
      const key = (item.key || item.name || '').toUpperCase();
      return key !== 'TRAIT' && key !== 'TRAITS';
    })
    .map((item, index) => {
      const key = item.key || item.name || `Attribute ${index + 1}`;
      const value = item.value || item.val || '';
      return { key, value };
    });

  if (loading) {
    return (
      <div className="product-card-page">
        <NavigationBar className="product-header" />
        <main className="product-main">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading product details...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="product-card-page">
        <NavigationBar className="product-header" />
        <main className="product-main">
          <div className="error-state">
            <p className="error-message">⚠️ {error || 'Product not found'}</p>
            <button onClick={loadProductData} className="retry-button">
              Try Again
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Extract product fields (handle different naming conventions)
  const productName = product.name || 'Unknown Product';
  const number = product.Number || product.number; // Get Number field from product
  const imageUrl = product.image_url || product.imageUrl || product.image;
  const productUrl = product.url;
  const categoryId = product.category_id || product.categoryId;
  const groupId = product.group_id || product.groupId;

  // Extract group fields
  const groupName = group?.name || 'Unknown Release';
  const groupAbbreviation = group?.abbreviation || group?.abbr;
  const publishedOn = group?.published_on || group?.publishedOn;
  const isSupplemental = group?.is_supplemental || group?.isSupplemental;

  return (
    <div className="product-card-page">
      <NavigationBar className="product-header" />

      <main className="product-main">
        <div className="product-container">
          {/* Product Image and Primary Info Side by Side */}
          <div className="product-hero">
            {/* Product Image */}
            <div className="product-image-section">
              {imageUrl ? (
                <img 
                  src={imageUrl} 
                  alt={productName}
                  className="product-hero-image"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextSibling) {
                      e.target.nextSibling.style.display = 'flex';
                    }
                  }}
                />
              ) : null}
              <div className="product-image-placeholder" style={{ display: imageUrl ? 'none' : 'flex' }}>
                <span className="placeholder-icon">🎴</span>
              </div>
            </div>

            {/* Product Info Section (title + level/cost/stats/description + attributes) */}
            <div className="product-info-section">
              <div className="product-title-wrapper">
                <h1 className="product-title">
                  {productName}
                  {number && <div className="product-number-big"> #{number}</div>}
                </h1>
                {user && (
                  <button
                    className={`favorite-button ${isFavoritedState ? 'favorited' : ''}`}
                    onClick={handleFavoriteToggle}
                    aria-label={isFavoritedState ? 'Remove from favorites' : 'Add to favorites'}
                    title={isFavoritedState ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {isFavoritedState ? '★' : '☆'}
                  </button>
                )}
              </div>

              {/* Level, Cost, Stats, and Description Section (similar to preview modal) */}
              {((level || (cost !== null && cost !== undefined)) || description || attackPoints || hitPoints) && (
                <div className={`product-card-main-wrapper ${!description ? 'product-card-no-description' : ''}`}>
                  {description ? (
                    /* Layout with description: Left column (Level/Cost + Stats) | Description */
                    <>
                      {/* Left Column: Level/Cost and Stats */}
                      <div className="product-card-left-column">
                        {/* Level and Cost Section */}
                        {(level || (cost !== null && cost !== undefined)) && (
                          <div className="product-card-level-cost">
                            {cardType && (() => {
                              const brightness = color ? getColorBrightness(color) : 'dark';
                              const textColor = brightness === 'light' ? '#1f2937' : '#ffffff';
                              const textShadow = brightness === 'light' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.2)';
                              const borderStyle = brightness === 'light' ? { border: '1px solid #718096' } : {};
                              return (
                                <div 
                                  className="product-card-card-type product-card-card-type-rotated"
                                  style={color ? { 
                                    backgroundColor: color,
                                    color: textColor,
                                    textShadow: textShadow,
                                    ...borderStyle
                                  } : {}}
                                >
                                  {cardType}
                                </div>
                              );
                            })()}
                            {level && (() => {
                              const brightness = color ? getColorBrightness(color) : 'dark';
                              const textColor = brightness === 'light' ? '#718096' : (color || '#4a5568');
                              return (
                                <div 
                                  className="product-card-level"
                                  style={{ color: textColor }}
                                >
                                  Lv. {level}
                                </div>
                              );
                            })()}
                            {cost !== null && cost !== undefined && (() => {
                              const brightness = color ? getColorBrightness(color) : 'dark';
                              const textColor = brightness === 'light' ? '#718096' : (color || '#667eea');
                              return (
                                <div className="product-card-cost-section">
                                  <div 
                                    className="product-card-cost-value"
                                    style={{ color: textColor }}
                                  >
                                    {cost}
                                  </div>
                                  <div 
                                    className="product-card-cost-label"
                                    style={{ color: textColor }}
                                  >
                                    cost
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Attack Points and Hit Points boxes below level/cost */}
                        {(attackPoints || hitPoints) && (
                          <div className="product-card-stats-wrapper">
                            {attackPoints && (
                              <div className="product-card-stat-box product-card-atk-box">
                                <div className="product-card-stat-value">{attackPoints}</div>
                                <div className="product-card-stat-label">ATK</div>
                              </div>
                            )}
                            {hitPoints && (
                              <div className="product-card-stat-box product-card-hp-box">
                                <div className="product-card-stat-value">{hitPoints}</div>
                                <div className="product-card-stat-label">HP</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right Column: Description */}
                      <div className="product-card-description-container">
                        <div 
                          className="product-card-description"
                          dangerouslySetInnerHTML={{ __html: formatDescription(description) }}
                        />
                      </div>
                    </>
                  ) : (
                    /* Layout without description: Level/Cost | ATK | HP (all side by side) */
                    <>
                      {/* Level and Cost Section */}
                      {(level || (cost !== null && cost !== undefined)) && (
                        <div className="product-card-level-cost">
                          {cardType && (() => {
                            const brightness = color ? getColorBrightness(color) : 'dark';
                            const textColor = brightness === 'light' ? '#1f2937' : '#ffffff';
                            const textShadow = brightness === 'light' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.2)';
                            const borderStyle = brightness === 'light' ? { border: '1px solid #718096' } : {};
                            return (
                              <div 
                                className="product-card-card-type product-card-card-type-rotated"
                                style={color ? { 
                                  backgroundColor: color,
                                  color: textColor,
                                  textShadow: textShadow,
                                  ...borderStyle
                                } : {}}
                              >
                                {cardType}
                              </div>
                            );
                          })()}
                          {level && (() => {
                            const brightness = color ? getColorBrightness(color) : 'dark';
                            const textColor = brightness === 'light' ? '#718096' : (color || '#4a5568');
                            return (
                              <div 
                                className="product-card-level"
                                style={{ color: textColor }}
                              >
                                Lv. {level}
                              </div>
                            );
                          })()}
                          {cost !== null && cost !== undefined && (() => {
                            const brightness = color ? getColorBrightness(color) : 'dark';
                            const textColor = brightness === 'light' ? '#718096' : (color || '#667eea');
                            return (
                              <div className="product-card-cost-section">
                                <div 
                                  className="product-card-cost-value"
                                  style={{ color: textColor }}
                                >
                                  {cost}
                                </div>
                                <div 
                                  className="product-card-cost-label"
                                  style={{ color: textColor }}
                                >
                                  cost
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Attack Points and Hit Points boxes to the right of level/cost */}
                      {(attackPoints || hitPoints) && (
                        <div className="product-card-stats-wrapper product-card-stats-horizontal">
                          {attackPoints && (
                            <div className="product-card-stat-box product-card-atk-box">
                              <div className="product-card-stat-value">{attackPoints}</div>
                              <div className="product-card-stat-label">ATK</div>
                            </div>
                          )}
                          {hitPoints && (
                            <div className="product-card-stat-box product-card-hp-box">
                              <div className="product-card-stat-value">{hitPoints}</div>
                              <div className="product-card-stat-label">HP</div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {traitTags.length > 0 && (
                <div className="product-card-traits">
                  {traitTags.map((tag, index) => (
                    <span key={`${tag}-${index}`} className="product-card-trait-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Card Information and Attributes */}
              {allAttributes.length > 0 && (
                <div className="extended-data-section">
                  <h2 className="section-title">Card Information</h2>
                  <div className="attributes-grid">
                    {allAttributes.map((item, index) => (
                      <div key={`attr-${item.key}-${index}`} className="attribute-box">
                        <span className="attribute-key">{item.key}</span>
                        <div 
                          className="attribute-value"
                          dangerouslySetInnerHTML={{ __html: formatDescription(item.value || 'N/A') }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Market Section: Price History Chart and Pricing Information Side by Side */}
          {((priceHistory.length > 0 || vendorPriceHistory.length > 0) || (currentPrice || vendorPrices.length > 0 || loadingPrice)) && (
                <div className="market-section">
                  <h2 className="section-title">Market</h2>
                  <div className="market-content-wrapper">
                    {/* Historical Pricing Chart */}
                    {(priceHistory.length > 0 || vendorPriceHistory.length > 0) && (
                      <div className="price-history-section">
                        <div className="price-chart-container">
                          <PriceChart history={priceHistory} vendorHistory={vendorPriceHistory} />
                        </div>
                      </div>
                    )}

                    {/* Pricing Information */}
                    {(currentPrice || vendorPrices.length > 0 || loadingPrice) && (
                      <div className="pricing-section">
                        {loadingPrice ? (
                          <div className="pricing-loading">
                            <span className="loading-text">Loading pricing data...</span>
                          </div>
                        ) : (
                          <div className="pricing-content">
                            {/* TCGPlayer Prices */}
                            {currentPrice && (
                              <div className="vendor-pricing-group">
                                <h3 className="vendor-name">
                                  {
                                      productUrl && (
                                          <a 
                                          href={productUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="info-link"
                                      >
                                          TCGPlayer
                                      </a>
                                      )
                                  }

                                </h3>
                                <div className="pricing-grid">
                                  {currentPrice.market_price !== null && currentPrice.market_price !== undefined && (
                                    <div className="price-item">
                                      <span className="price-label">Market Price:</span>
                                      <span className="price-value">${parseFloat(currentPrice.market_price || currentPrice.marketPrice || 0).toFixed(2)}</span>
                                    </div>
                                  )}
                                  {currentPrice.low_price !== null && currentPrice.low_price !== undefined && (
                                    <div className="price-item">
                                      <span className="price-label">Low Price:</span>
                                      <span className="price-value">${parseFloat(currentPrice.low_price || currentPrice.lowPrice || 0).toFixed(2)}</span>
                                    </div>
                                  )}
                                  {currentPrice.high_price !== null && currentPrice.high_price !== undefined && (
                                    <div className="price-item">
                                      <span className="price-label">High Price:</span>
                                      <span className="price-value">${parseFloat(currentPrice.high_price || currentPrice.highPrice || 0).toFixed(2)}</span>
                                    </div>
                                  )}
                                </div>
                                {currentPrice.direct_low_price !== null && currentPrice.direct_low_price !== undefined && (
                                  <div className="price-item price-item-direct-low">
                                    <span className="price-label">Direct Low:</span>
                                    <span className="price-value">${parseFloat(currentPrice.direct_low_price || currentPrice.directLowPrice || 0).toFixed(2)}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Vendor Prices */}
                            {vendorPrices.length > 0 && vendorPrices.map((vendorPrice, index) => {
                              const vendorName = vendorPrice.vendor_name || vendorPrice.vendorName || vendorPrice.vendor || 'Unknown Vendor';
                              const title = vendorPrice.title || vendorPrice.name || '';
                              const quickshopUrl = vendorPrice.quickshop_url || vendorPrice.quickshopUrl || vendorPrice.url || '';
                              return (
                                <div key={`vendor-${index}`} className="vendor-pricing-group">
                                  <div className="vendor-header">
                                    <h3 className="vendor-name">
                                      {quickshopUrl && (
                                        <a 
                                          href={quickshopUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="vendor-quickshop-link"
                                        >
                                          {vendorName}
                                        </a>
                                      )}
                                    </h3>
                                  </div>
                                  <div className="pricing-grid">
                                    {vendorPrice.market_price !== null && vendorPrice.market_price !== undefined && (
                                      <div className="price-item">
                                        <span className="price-label">Market Price:</span>
                                        <span className="price-value">${parseFloat(vendorPrice.market_price || vendorPrice.marketPrice || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {vendorPrice.low_price !== null && vendorPrice.low_price !== undefined && (
                                      <div className="price-item">
                                        <span className="price-label">Low Price:</span>
                                        <span className="price-value">${parseFloat(vendorPrice.low_price || vendorPrice.lowPrice || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {vendorPrice.high_price !== null && vendorPrice.high_price !== undefined && (
                                      <div className="price-item">
                                        <span className="price-label">High Price:</span>
                                        <span className="price-value">${parseFloat(vendorPrice.high_price || vendorPrice.highPrice || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {!currentPrice && vendorPrices.length === 0 && (
                              <p className="no-pricing-data">No pricing data available for this product.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
          )}

          {/* Release/Group Information (Feature 4a) */}
          {group && (
                <div className="release-info">
                  <h2 className="section-title">Release Information</h2>
                  <div className="info-grid">
                    <div className="info-item">
                      <span className="info-label">Release:</span>
                      <span className="info-value">{groupName}</span>
                    </div>
                    {groupAbbreviation && (
                      <div className="info-item">
                        <span className="info-label">Abbreviation:</span>
                        <span className="info-value">{groupAbbreviation}</span>
                      </div>
                    )}
                    {publishedOn && (
                      <div className="info-item">
                        <span className="info-label">Published:</span>
                        <span className="info-value">
                          {new Date(publishedOn).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    )}
                    {isSupplemental !== undefined && (
                      <div className="info-item">
                        <span className="info-label">Type:</span>
                        <span className="info-value">
                          {isSupplemental ? 'Supplemental' : 'Standard'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
          )}
        </div>
      </main>

      {/* Notification Modal */}
      <NotificationModal
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />
    </div>
  );
};

// Price Chart Component (Feature 4d)
const PriceChart = ({ history, vendorHistory = [] }) => {
  if ((!history || history.length === 0) && (!vendorHistory || vendorHistory.length === 0)) {
    return <p className="no-chart-data">No price history available.</p>;
  }

  // Extract data points for TCGPlayer market price (primary line)
  const tcgPlayerDataPoints = (history || []).map(item => {
    const date = new Date(item.fetched_at || item.fetchedAt);
    const marketPrice = parseFloat(item.market_price || item.marketPrice || 0);
    const lowPrice = parseFloat(item.low_price || item.lowPrice || 0);
    const highPrice = parseFloat(item.high_price || item.highPrice || 0);
    return {
      date,
      marketPrice,
      lowPrice,
      highPrice,
      dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
  });

  // Group vendor history by vendor name
  const vendorGroups = {};
  (vendorHistory || []).forEach(item => {
    const vendorName = item.vendor_name || item.vendorName || item.vendor || 'Unknown Vendor';
    if (!vendorGroups[vendorName]) {
      vendorGroups[vendorName] = [];
    }
    const date = new Date(item.fetched_at || item.fetchedAt || item.fetched_at_timestamp);
    const marketPrice = parseFloat(item.market_price || item.marketPrice || 0);
    vendorGroups[vendorName].push({
      date,
      marketPrice,
      dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    });
  });

  // Sort vendor data points by date
  Object.keys(vendorGroups).forEach(vendorName => {
    vendorGroups[vendorName].sort((a, b) => a.date - b.date);
  });

  // Calculate chart dimensions and scaling
  const chartHeight = 300;
  const chartWidth = 800; // Fixed width for viewBox
  const padding = 40;
  
  // Combine all data points for min/max calculation
  const allDataPoints = [...tcgPlayerDataPoints];
  Object.values(vendorGroups).forEach(vendorData => {
    allDataPoints.push(...vendorData.map(d => ({ marketPrice: d.marketPrice, lowPrice: 0, highPrice: 0 })));
  });
  
  // Find min/max values for scaling
  const allPrices = allDataPoints.flatMap(d => [d.marketPrice, d.lowPrice || 0, d.highPrice || 0]).filter(v => v > 0);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
  const priceRange = maxPrice - minPrice || 1; // Avoid division by zero

  // Calculate Y position for a price value
  const getY = (price) => {
    if (price <= 0) return chartHeight - padding;
    return padding + (chartHeight - 2 * padding) * (1 - (price - minPrice) / priceRange);
  };

  // Combine all dates for x-axis to calculate proper positioning (calculate before generating paths)
  const allDatesForCalc = new Set();
  tcgPlayerDataPoints.forEach(d => allDatesForCalc.add(d.date.getTime()));
  Object.values(vendorGroups).forEach(vendorData => {
    vendorData.forEach(d => allDatesForCalc.add(d.date.getTime()));
  });
  const sortedDatesForCalc = Array.from(allDatesForCalc).sort((a, b) => a - b);
  const minDate = sortedDatesForCalc.length > 0 ? sortedDatesForCalc[0] : Date.now();
  const maxDate = sortedDatesForCalc.length > 0 ? sortedDatesForCalc[sortedDatesForCalc.length - 1] : Date.now();
  const dateRange = maxDate - minDate || 1;

  // Helper to calculate x position based on date
  const getX = (date) => {
    const dateTime = date.getTime();
    const ratio = (dateTime - minDate) / dateRange;
    return padding + ratio * (chartWidth - 2 * padding);
  };

  // Generate path for TCGPlayer market price line
  const tcgPlayerPath = tcgPlayerDataPoints.map((point, index) => {
    const x = getX(point.date);
    const y = getY(point.marketPrice);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  // Generate paths for vendor price lines
  const vendorColors = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const vendorPaths = Object.keys(vendorGroups).map((vendorName, vendorIndex) => {
    const vendorData = vendorGroups[vendorName];
    const path = vendorData.map((point, index) => {
      const x = getX(point.date);
      const y = getY(point.marketPrice);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
    return {
      vendorName,
      path,
      color: vendorColors[vendorIndex % vendorColors.length]
    };
  });

  return (
    <div className="price-chart">
      <svg 
        viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
        preserveAspectRatio="none"
        className="chart-svg"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
          const y = padding + (chartHeight - 2 * padding) * (1 - ratio);
          const price = minPrice + priceRange * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padding}
                y1={y}
                x2={chartWidth - padding}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text
                x={padding - 5}
                y={y + 4}
                fontSize="10"
                fill="#718096"
                textAnchor="end"
              >
                ${price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* TCGPlayer market price line */}
        {tcgPlayerDataPoints.length > 0 && (
          <>
            <path
              d={tcgPlayerPath}
              fill="none"
              stroke="#667eea"
              strokeWidth="2"
              className="market-price-line"
            />
            {/* TCGPlayer data points */}
            {tcgPlayerDataPoints.map((point, index) => {
              const x = getX(point.date);
              const y = getY(point.marketPrice);
              return (
                <circle
                  key={`tcg-${index}`}
                  cx={x}
                  cy={y}
                  r="3"
                  fill="#667eea"
                  className="data-point"
                />
              );
            })}
          </>
        )}

        {/* Vendor price lines */}
        {vendorPaths.map(({ vendorName, path, color }, vendorIndex) => {
          const vendorData = vendorGroups[vendorName];
          return (
            <g key={`vendor-${vendorIndex}`}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="2"
                className="vendor-price-line"
                strokeDasharray="4,2"
              />
              {vendorData.map((point, index) => {
                const x = getX(point.date);
                const y = getY(point.marketPrice);
                return (
                  <circle
                    key={`vendor-${vendorIndex}-${index}`}
                    cx={x}
                    cy={y}
                    r="2.5"
                    fill={color}
                    className="vendor-data-point"
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      
      {/* X-axis labels */}
      <div className="chart-labels">
        {sortedDatesForCalc.length > 0 && (
          <>
            <span className="chart-label-start">
              {new Date(sortedDatesForCalc[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span className="chart-label-end">
              {new Date(sortedDatesForCalc[sortedDatesForCalc.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="chart-legend">
        {tcgPlayerDataPoints.length > 0 && (
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#667eea' }}></span>
            <span className="legend-label">TCGPlayer</span>
          </div>
        )}
        {vendorPaths.map(({ vendorName, color }) => (
          <div key={vendorName} className="legend-item">
            <span className="legend-color" style={{ backgroundColor: color }}></span>
            <span className="legend-label">{vendorName}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductCardPage;

