import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isFavorited, toggleFavorite } from '../lib/favorites';
import { fetchProductById, extractExtendedDataFromProduct, fetchGroupById, fetchCurrentPrice, fetchPriceHistory } from '../lib/api';
import NotificationModal from './NotificationModal';
import './ProductCardPage.css';

const ProductCardPage = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [product, setProduct] = useState(null);
  const [group, setGroup] = useState(null);
  const [extendedData, setExtendedData] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
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
      
      // Fetch current price and price history in parallel
      const [price, history] = await Promise.all([
        fetchCurrentPrice(productId),
        fetchPriceHistory(productId)
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
    } catch (err) {
      console.error('Error loading pricing data:', err);
      // Don't set error state - pricing is optional
      setCurrentPrice(null);
      setPriceHistory([]);
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

  if (loading) {
    return (
      <div className="product-card-page">
        <header className="product-header">
          <div className="header-content">
            <Link to="/" className="logo-link">
              <h1 className="logo">TCGConvert</h1>
            </Link>
            <nav className="header-nav">
              {user ? (
                <div className="user-menu">
                  <button onClick={signOut} className="nav-button">Sign Out</button>
                </div>
              ) : (
                <div className="auth-links">
                  <Link to="/login" className="nav-link">Log In</Link>
                  <Link to="/signup" className="nav-link nav-link-primary">Sign Up</Link>
                </div>
              )}
            </nav>
          </div>
        </header>
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
        <header className="product-header">
          <div className="header-content">
            <Link to="/" className="logo-link">
              <h1 className="logo">TCGConvert</h1>
            </Link>
            <nav className="header-nav">
              {user ? (
                <div className="user-menu">
                  <button onClick={signOut} className="nav-button">Sign Out</button>
                </div>
              ) : (
                <div className="auth-links">
                  <Link to="/login" className="nav-link">Log In</Link>
                  <Link to="/signup" className="nav-link nav-link-primary">Sign Up</Link>
                </div>
              )}
            </nav>
          </div>
        </header>
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

  // Separate extended data into regular attributes and textual information
  const textualKeys = ['DESCRIPTION', 'TRIGGER', 'EFFECT', 'SUBTYPES'];
  const regularAttributes = [];
  const textualInformation = [];

  extendedData.forEach((item, index) => {
    const key = item.key || item.name || `Attribute ${index + 1}`;
    const value = item.value || item.val || '';
    const keyUpper = key.toUpperCase();
    
    // Check if it's textual information
    // - Keys named DESCRIPTION, TRIGGER, EFFECT, or SUBTYPES
    // - Any attribute with a value longer than 40 characters
    const isTextual = 
      textualKeys.some(textKey => keyUpper === textKey) || 
      (value && value.length > 40);
    
    if (isTextual) {
      textualInformation.push({ key, value });
    } else {
      regularAttributes.push({ key, value });
    }
  });

  return (
    <div className="product-card-page">
      <header className="product-header">
        <div className="header-content">
          <Link to="/" className="logo-link">
            <h1 className="logo">TCGConvert</h1>
          </Link>
          <nav className="header-nav">
            {user ? (
              <div className="user-menu">
                <Link to="/inventory" className="nav-link">Inventory</Link>
                <Link to="/deck-lists" className="nav-link">Deck Lists</Link>
                <button onClick={signOut} className="nav-button">Sign Out</button>
              </div>
            ) : (
              <div className="auth-links">
                <Link to="/login" className="nav-link">Log In</Link>
                <Link to="/signup" className="nav-link nav-link-primary">Sign Up</Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      <main className="product-main">
        <div className="product-container">
          {/* Product Image and Basic Info */}
          <div className="product-hero">
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

            <div className="product-info-section">
              <div className="product-title-wrapper">
                <h1 className="product-title">
                  {productName}
                  {number && <span className="product-number-big"> #{number}</span>}
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

              {/* Textual Information (DESCRIPTION, TRIGGER, EFFECT, or long values) */}
              {textualInformation.length > 0 && (
                <div className="textual-information-section">
                  <h2 className="section-title">Card Information</h2>
                  <div className="textual-information-list">
                    {textualInformation.map((item, index) => (
                      <div key={`textual-${item.key}-${index}`} className="textual-item">
                        <h3 className="textual-key">{item.key}</h3>
                        <div 
                          className="textual-value"
                          dangerouslySetInnerHTML={{ __html: item.value || 'N/A' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Product Extended Data as Attribute Boxes (Feature 4b) */}
              {regularAttributes.length > 0 && (
                <div className="extended-data-section">
                  <h2 className="section-title">Attributes</h2>
                  <div className="attributes-grid">
                    {regularAttributes.map((item, index) => (
                      <div key={`attr-${item.key}-${index}`} className="attribute-box">
                        <span className="attribute-key">{item.key}</span>
                        <span className="attribute-value">{item.value || 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pricing Information (Feature 4c) */}
              {(currentPrice || loadingPrice) && (
                <div className="pricing-section">
                  <h2 className="section-title">Pricing Information</h2>
                  {loadingPrice ? (
                    <div className="pricing-loading">
                      <span className="loading-text">Loading pricing data...</span>
                    </div>
                  ) : currentPrice ? (
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
                      {currentPrice.mid_price !== null && currentPrice.mid_price !== undefined && (
                        <div className="price-item">
                          <span className="price-label">Mid Price:</span>
                          <span className="price-value">${parseFloat(currentPrice.mid_price || currentPrice.midPrice || 0).toFixed(2)}</span>
                        </div>
                      )}
                      {currentPrice.direct_low_price !== null && currentPrice.direct_low_price !== undefined && (
                        <div className="price-item">
                          <span className="price-label">Direct Low:</span>
                          <span className="price-value">${parseFloat(currentPrice.direct_low_price || currentPrice.directLowPrice || 0).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="no-pricing-data">No pricing data available for this product.</p>
                  )}
                </div>
              )}

              {/* Historical Pricing Chart (Feature 4d) */}
              {priceHistory.length > 0 && (
                <div className="price-history-section">
                  <h2 className="section-title">Price History</h2>
                  <div className="price-chart-container">
                    <PriceChart history={priceHistory} />
                  </div>
                </div>
              )}

              {/* Additional Product Info */}
              <div className="product-details">
                <h2 className="section-title">Product Details</h2>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Product ID:</span>
                    <span className="info-value">{productId}</span>
                  </div>
                  {categoryId && (
                    <div className="info-item">
                      <span className="info-label">Category ID:</span>
                      <span className="info-value">{categoryId}</span>
                    </div>
                  )}
                  {groupId && (
                    <div className="info-item">
                      <span className="info-label">Group ID:</span>
                      <span className="info-value">{groupId}</span>
                    </div>
                  )}
                  {productUrl && (
                    <div className="info-item">
                      <span className="info-label">External URL:</span>
                      <a 
                        href={productUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="info-link"
                      >
                        View on TCGPlayer
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
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
const PriceChart = ({ history }) => {
  if (!history || history.length === 0) {
    return <p className="no-chart-data">No price history available.</p>;
  }

  // Extract data points for market price (primary line)
  const dataPoints = history.map(item => {
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

  // Calculate chart dimensions and scaling
  const chartHeight = 300;
  const chartWidth = 800; // Fixed width for viewBox
  const padding = 40;
  
  // Find min/max values for scaling
  const allPrices = dataPoints.flatMap(d => [d.marketPrice, d.lowPrice, d.highPrice]).filter(v => v > 0);
  const minPrice = Math.min(...allPrices, 0);
  const maxPrice = Math.max(...allPrices, 0);
  const priceRange = maxPrice - minPrice || 1; // Avoid division by zero

  // Calculate Y position for a price value
  const getY = (price) => {
    if (price <= 0) return chartHeight - padding;
    return padding + (chartHeight - 2 * padding) * (1 - (price - minPrice) / priceRange);
  };

  // Generate path for market price line
  const marketPath = dataPoints.map((point, index) => {
    const x = padding + (index / (dataPoints.length - 1 || 1)) * (chartWidth - 2 * padding);
    const y = getY(point.marketPrice);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

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

        {/* Market price line */}
        <path
          d={marketPath}
          fill="none"
          stroke="#667eea"
          strokeWidth="2"
          className="market-price-line"
        />

        {/* Data points */}
        {dataPoints.map((point, index) => {
          const x = padding + (index / (dataPoints.length - 1 || 1)) * (chartWidth - 2 * padding);
          const y = getY(point.marketPrice);
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="3"
              fill="#667eea"
              className="data-point"
            />
          );
        })}
      </svg>
      
      {/* X-axis labels */}
      <div className="chart-labels">
        {dataPoints.length > 0 && (
          <>
            <span className="chart-label-start">{dataPoints[0].dateStr}</span>
            <span className="chart-label-end">{dataPoints[dataPoints.length - 1].dateStr}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default ProductCardPage;

