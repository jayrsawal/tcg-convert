import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProductById, extractExtendedDataFromProduct } from '../lib/api';
import { formatDescription } from '../lib/descriptionFormatter';
import './ProductPreviewModal.css';

const ProductPreviewModal = ({ productId, isOpen, onClose, navigateWithCheck }) => {
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [extendedData, setExtendedData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadProduct = useCallback(async () => {
    if (!productId) return;
    
    try {
      setLoading(true);
      setError(null);
      const productData = await fetchProductById(productId);
      setProduct(productData);
      const extendedDataArray = extractExtendedDataFromProduct(productData);
      setExtendedData(extendedDataArray);
    } catch (err) {
      setError(err.message || 'Failed to load product');
      console.error('Error loading product:', err);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (isOpen && productId) {
      loadProduct();
    } else {
      setProduct(null);
      setExtendedData([]);
      setError(null);
    }
  }, [isOpen, productId, loadProduct]);

  const handleViewFullPage = () => {
    if (navigateWithCheck) {
      navigateWithCheck(`/products/${productId}`);
    } else {
      navigate(`/products/${productId}`);
    }
  };

  // Helper function to map color names to hex values (similar to sidebar)
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

  // Helper function to get color brightness (similar to sidebar)
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
        return false; // Don't show in regular attributes (we'll show it in description)
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

  if (!isOpen) return null;

  return (
    <div className="product-preview-modal-overlay" onClick={onClose}>
      <div className="product-preview-modal" onClick={(e) => e.stopPropagation()}>
        <button className="product-preview-close" onClick={onClose}>×</button>
        
        {loading && (
          <div className="product-preview-loading">
            <div className="spinner"></div>
            <p>Loading product...</p>
          </div>
        )}

        {error && (
          <div className="product-preview-error">
            <p>⚠️ {error}</p>
          </div>
        )}

        {!loading && !error && product && (
          <>
            <div className="product-preview-header">
              <h2 className="product-preview-name">{product.name || 'Unknown Product'}</h2>
              {product.number && (
                <span className="product-preview-number">#{product.number}</span>
              )}
            </div>

            <div className="product-preview-content">
              {product.image_url || product.imageUrl ? (
                <div className="product-preview-image-container">
                  <img 
                    src={product.image_url || product.imageUrl} 
                    alt={product.name}
                    className="product-preview-image"
                  />
                </div>
              ) : (
                <div className="product-preview-image-placeholder">
                  <span>No Image Available</span>
                </div>
              )}

              <div className="product-preview-details">
                {/* Level, Cost, and Description Section */}
                {((level || (cost !== null && cost !== undefined)) || description) && (
                  <div className={`product-preview-main-wrapper ${!description ? 'product-preview-no-description' : ''}`}>
                    {description ? (
                      /* Layout with description: Left column (Level/Cost + Stats) | Description */
                      <>
                        {/* Left Column: Level/Cost and Stats */}
                        <div className="product-preview-left-column">
                          {/* Level and Cost Section */}
                          {(level || (cost !== null && cost !== undefined)) && (
                            <div className="product-preview-level-cost">
                              {cardType && (() => {
                                const brightness = color ? getColorBrightness(color) : 'dark';
                                const textColor = brightness === 'light' ? '#1f2937' : '#ffffff';
                                const textShadow = brightness === 'light' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.2)';
                                const borderStyle = brightness === 'light' ? { border: '1px solid #718096' } : {};
                                return (
                                  <div 
                                    className="product-preview-card-type product-preview-card-type-rotated"
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
                                    className="product-preview-level"
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
                                  <div className="product-preview-cost-section">
                                    <div 
                                      className="product-preview-cost-value"
                                      style={{ color: textColor }}
                                    >
                                      {cost}
                                    </div>
                                    <div 
                                      className="product-preview-cost-label"
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
                            <div className="product-preview-stats-wrapper">
                              {attackPoints && (
                                <div className="product-preview-stat-box product-preview-atk-box">
                                  <div className="product-preview-stat-value">{attackPoints}</div>
                                  <div className="product-preview-stat-label">ATK</div>
                                </div>
                              )}
                              {hitPoints && (
                                <div className="product-preview-stat-box product-preview-hp-box">
                                  <div className="product-preview-stat-value">{hitPoints}</div>
                                  <div className="product-preview-stat-label">HP</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Right Column: Description */}
                        <div className="product-preview-description-container">
                          <div 
                            className="product-preview-description"
                            dangerouslySetInnerHTML={{ __html: formatDescription(description) }}
                          />
                        </div>
                      </>
                    ) : (
                      /* Layout without description: Level/Cost | ATK | HP (all side by side) */
                      <>
                        {/* Level and Cost Section */}
                        {(level || (cost !== null && cost !== undefined)) && (
                          <div className="product-preview-level-cost">
                            {cardType && (() => {
                              const brightness = color ? getColorBrightness(color) : 'dark';
                              const textColor = brightness === 'light' ? '#1f2937' : '#ffffff';
                              const textShadow = brightness === 'light' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.2)';
                              const borderStyle = brightness === 'light' ? { border: '1px solid #718096' } : {};
                              return (
                                <div 
                                  className="product-preview-card-type product-preview-card-type-rotated"
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
                                  className="product-preview-level"
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
                                <div className="product-preview-cost-section">
                                  <div 
                                    className="product-preview-cost-value"
                                    style={{ color: textColor }}
                                  >
                                    {cost}
                                  </div>
                                  <div 
                                    className="product-preview-cost-label"
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
                          <div className="product-preview-stats-wrapper product-preview-stats-horizontal">
                            {attackPoints && (
                              <div className="product-preview-stat-box product-preview-atk-box">
                                <div className="product-preview-stat-value">{attackPoints}</div>
                                <div className="product-preview-stat-label">ATK</div>
                              </div>
                            )}
                            {hitPoints && (
                              <div className="product-preview-stat-box product-preview-hp-box">
                                <div className="product-preview-stat-value">{hitPoints}</div>
                                <div className="product-preview-stat-label">HP</div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Other Details */}
                {filteredExtendedData.length > 0 && (
                  <>
                    <h3 className="product-preview-details-title">Details</h3>
                    <div className="product-preview-attributes">
                      {filteredExtendedData.map((item, index) => {
                        const key = item.key || item.name || '';
                        const value = item.value || item.val || '';
                        if (!key || !value) return null;
                        
                        // Check if this is a textual field (TRIGGER, EFFECT, or long text)
                        const keyUpper = key.toUpperCase();
                        const isTextual = ['TRIGGER', 'EFFECT', 'SUBTYPES'].includes(keyUpper) || value.length > 40;
                        
                        return (
                          <div key={index} className="product-preview-attribute">
                            <span className="attribute-key">{key}:</span>
                            {isTextual ? (
                              <div 
                                className="attribute-value attribute-value-textual"
                                dangerouslySetInnerHTML={{ __html: formatDescription(value) }}
                              />
                            ) : (
                              <span className="attribute-value">{value}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="product-preview-actions">
              <button 
                className="product-preview-view-full-button"
                onClick={handleViewFullPage}
              >
                View Full Page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProductPreviewModal;

