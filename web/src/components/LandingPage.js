import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
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
      return;
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
        return;
      }
      
      // Fetch inventory stats and product counts in parallel
      const [statsData, productCountsData] = await Promise.all([
        fetchInventoryStatsByCategory(user.id, categoryId),
        fetchProductCountsByCategory(categoryId)
      ]);

      // Handle response format - could be single object or array
      let stat = null;
      let productCount = null;
      
      if (Array.isArray(statsData)) {
        stat = statsData.find(s => {
          const catId = parseInt(s.category_id || s.categoryId || s.id, 10);
          return catId === categoryId;
        });
      } else if (statsData && (statsData.category_id || statsData.categoryId)) {
        stat = statsData;
      }
      
      if (Array.isArray(productCountsData)) {
        productCount = productCountsData.find(c => {
          const catId = parseInt(c.category_id || c.categoryId || c.id, 10);
          return catId === categoryId;
        });
      } else if (productCountsData && typeof productCountsData === 'number') {
        // If it's just a number, use it directly
        productCount = { total_products: productCountsData, totalProducts: productCountsData };
      } else if (productCountsData && (productCountsData.category_id || productCountsData.categoryId)) {
        productCount = productCountsData;
      }

      setCategoryStats({
        totalCardsOwned: stat?.total_cards || stat?.totalCards || 0,
        uniqueCardsOwned: stat?.unique_cards || stat?.uniqueCards || 0,
        totalUniqueProducts: productCount?.total_products || productCount?.totalProducts || productCountsData || 0
      });
    } catch (err) {
      console.error('Error loading inventory stats:', err);
      setCategoryStats({
        totalCardsOwned: 0,
        uniqueCardsOwned: 0,
        totalUniqueProducts: 0
      });
    }
  }, [user, category]);

  const loadInventoryValue = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      // Get user's inventory
      const inventory = await getUserInventory(user.id);
      
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
      loadInventoryStats();
      loadInventoryValue();
    }
  }, [user, category, loadInventoryStats, loadInventoryValue]);


  const handleCategoryClick = (categoryId) => {
    // Navigate to products page with category ID (Feature 2a)
    navigate('/inventory');
  };

  return (
    <div className="landing-page">
      <NavigationBar className="landing-header" />

      <main className="landing-main">
        <div className="hero-section">
          <h2>Welcome to TCGConvert</h2>
          <p className="hero-subtitle">
            Your destination for building and trading card game decks
          </p>
        </div>

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
          <h2 className="decks-section-title">New Decks</h2>
          <DecksSection 
            user={null}
            categoryId={86}
            showAddDeck={false}
            maxDecks={4}
            sortBy="recent"
            fetchAllUsers={true}
          />
        </div>

        {/* User's Decks Section */}
        {user && (
          <div className="decks-section-home">
            <h2 className="decks-section-title">Your Decks</h2>
            <DecksSection 
              user={user} 
              categoryId={86}
              showAddDeck={true}
              maxDecks={3}
              sortBy="recent"
              addDeckRedirect="/deck-lists"
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default LandingPage;
