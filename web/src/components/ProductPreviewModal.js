import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProductById, extractExtendedDataFromProduct } from '../lib/api';
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

              {extendedData.length > 0 && (
                <div className="product-preview-details">
                  <h3 className="product-preview-details-title">Details</h3>
                  <div className="product-preview-attributes">
                    {extendedData.map((item, index) => {
                      const key = item.key || item.name || '';
                      const value = item.value || item.val || '';
                      if (!key || !value) return null;
                      
                      return (
                        <div key={index} className="product-preview-attribute">
                          <span className="attribute-key">{key}:</span>
                          <span className="attribute-value">{value}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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

