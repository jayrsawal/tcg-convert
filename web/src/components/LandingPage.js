import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchCategories, fetchInventoryStatsByCategory, fetchProductCountsByCategory, fetchCurrentPricesBulk } from '../lib/api';
import { getUserInventory } from '../lib/inventory';
import NavigationBar from './NavigationBar';
import DecksSection from './DecksSection';
import './LandingPage.css';
import './DeckListsPage.css';

const LandingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState(null);
  const [categoryStats, setCategoryStats] = useState(null);
  const [totalInventoryValue, setTotalInventoryValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const heroLogoUrl = `${process.env.PUBLIC_URL || ''}/strikerpack-1.png`;

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCategories();
      
      if (Array.isArray(data)) {
        // Find category 86
        const category86 = data.find(cat => {
          const catId = cat.category_id || cat.categoryId || cat.id;
          return String(catId) === '86';
        });
        setCategory(category86 || null);
      } else {
        console.warn('Categories is not an array:', data);
        setCategory(null);
        setError('Invalid data format received from API');
      }
    } catch (err) {
      setError(err.message || 'Failed to load categories');
      console.error('Error loading categories:', err);
      setCategory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInventoryStats = useCallback(async () => {
    if (!user || !category) {
      return null;
    }

    try {
      const categoryId = parseInt(category.category_id || category.categoryId || category.id, 10);
      
      if (isNaN(categoryId)) {
        console.error('Invalid category ID');
        setCategoryStats({
          totalCardsOwned: 0,
          uniqueCardsOwned: 0,
          totalUniqueProducts: 0
        });
        return null;
      }
      
      // Fetch inventory stats and product counts in parallel
      const [statsData, productCountsData] = await Promise.all([
        fetchInventoryStatsByCategory(user.id, categoryId),
        fetchProductCountsByCategory(categoryId)
      ]);

      // Handle response format - statsData is an object with totalCardsOwned, uniqueCardsOwned, items
      const stat = statsData || {};
      
      // productCountsData is now an object from filterProducts with { total, data, page, limit, has_more }
      const totalUniqueProducts = (productCountsData && typeof productCountsData === 'object' && 'total' in productCountsData)
        ? productCountsData.total
        : (typeof productCountsData === 'number' ? productCountsData : 0);

      setCategoryStats({
        totalCardsOwned: stat.totalCardsOwned || 0,
        uniqueCardsOwned: stat.uniqueCardsOwned || 0,
        totalUniqueProducts
      });

      // Return statsData so items can be reused
      return statsData;
    } catch (err) {
      console.error('Error loading inventory stats:', err);
      setCategoryStats({
        totalCardsOwned: 0,
        uniqueCardsOwned: 0,
        totalUniqueProducts: 0
      });
      return null;
    }
  }, [user, category]);

  const loadInventoryValue = useCallback(async (inventoryItems = null) => {
    if (!user) {
      return;
    }

    try {
      // Use provided inventory items if available, otherwise fetch
      let inventory = inventoryItems;
      if (!inventory) {
        inventory = await getUserInventory(user.id);
      }
      
      // Get product IDs from inventory
      const productIds = Object.keys(inventory)
        .filter(productId => inventory[productId] > 0)
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));

      if (productIds.length === 0) {
        setTotalInventoryValue(0);
        return;
      }

      // Fetch prices for all inventory items
      const prices = await fetchCurrentPricesBulk(productIds);

      // Calculate total value
      let totalValue = 0;
      Object.entries(inventory).forEach(([productId, quantity]) => {
        if (quantity > 0) {
          const price = prices[parseInt(productId, 10)];
          const marketPrice = price?.market_price || price?.marketPrice;
          if (marketPrice !== null && marketPrice !== undefined) {
            const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
            if (!isNaN(priceNum)) {
              totalValue += priceNum * quantity;
            }
          }
        }
      });

      setTotalInventoryValue(totalValue);
    } catch (err) {
      console.error('Error loading inventory value:', err);
      setTotalInventoryValue(0);
    }
  }, [user]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (user && category) {
      // Load stats first, then use the items from stats to load value (optimize API calls)
      loadInventoryStats().then((statsResult) => {
        // If statsResult has items, use them to avoid duplicate profile fetch
        if (statsResult && statsResult.items) {
          loadInventoryValue(statsResult.items);
        } else {
          loadInventoryValue();
        }
      }).catch(() => {
        // If stats fails, still try to load value
        loadInventoryValue();
      });
    }
  }, [user, category, loadInventoryStats, loadInventoryValue]);


  const handleCategoryClick = (categoryId) => {
    // Navigate to products page with category ID (Feature 2a)
    navigate('/inventory');
  };

  return (
    <div className="landing-page" style={{ '--app-bg-logo': `url(${heroLogoUrl})` }}>
      <NavigationBar className="landing-header" />

      <main className="landing-main">
        {/* <div className="hero-section">
          <img className="hero-logo" src="/strikerpack-1.png" alt="Striker Pack!" />
        </div> */}

        <div className="categories-section">          
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading category...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p className="error-message">⚠️ {error}</p>
              <button onClick={loadCategories} className="retry-button">
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && category && (
            <div className="category-card-container">
              <div
                className="category-card"
                onClick={() => handleCategoryClick(category.category_id || category.categoryId || category.id)}
              >
                <div className="category-icon">🎴</div>
                <h3 className="category-name">
                  {category.display_name || category.displayName || category.name || 'Category 86'}
                </h3>
                {category.name && category.name !== (category.display_name || category.displayName) && (
                  <p className="category-subtitle">{category.name}</p>
                )}
                {/* Inventory Stats - Only show if user is logged in */}
                {user && categoryStats && (
                  <div className="category-inventory-stats">
                    <div className="inventory-stat-line">
                      <span className="stat-label">Total Cards Owned:</span>
                      <span className="stat-value">{categoryStats.totalCardsOwned}</span>
                    </div>
                    <div className="inventory-stat-line">
                      <span className="stat-label">Unique Cards:</span>
                      <span className="stat-value">
                        {categoryStats.uniqueCardsOwned} / {categoryStats.totalUniqueProducts}
                      </span>
                    </div>
                    {totalInventoryValue > 0 && (
                      <div className="inventory-stat-line">
                        <span className="stat-label">Total Value:</span>
                        <span className="stat-value">${totalInventoryValue.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="category-arrow">→</div>
              </div>
            </div>
          )}
        </div>

        {/* Recent Decks Section - All Users */}
        <div className="decks-section-home">
          <div className="decks-section-header">
            <h2 className="decks-section-title">Recent Decks</h2>
            <Link to="/deck-lists" className="view-more-link">View More →</Link>
          </div>
          <DecksSection 
            user={null}
            categoryId={86}
            showAddDeck={false}
            maxDecks={4}
            sortBy="recent"
            fetchAllUsers={true}
            skipPricing={true}
            showUsername={true}
          />
        </div>
      </main>
    </div>
  );
};

export default LandingPage;
