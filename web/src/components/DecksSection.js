import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RiFileCopyFill } from "react-icons/ri";
import { fetchDeckLists, fetchAllDeckLists, createDeckList, updateDeckListName, deleteDeckList, fetchDeckList, fetchProductsBulk, extractExtendedDataFromProduct, fetchCurrentPricesBulk, fetchCategoryRules, updateDeckListItems } from '../lib/api';
import ExportDeckModal from './ExportDeckModal';
import NotificationModal from './NotificationModal';
import ConfirmationModal from './ConfirmationModal';
import DeckNamePromptModal from './DeckNamePromptModal';
import './DeckListsPage.css';

const DecksSection = ({ user, categoryId = 86, onDeckSelect, showAddDeck = true, maxDecks = null, sortBy = null, fetchAllUsers = false, addDeckRedirect = null, skipPricing = false, showUsername = false }) => {
  const navigate = useNavigate();
  const [deckLists, setDeckLists] = useState([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [showAddDeckForm, setShowAddDeckForm] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [categoryRules, setCategoryRules] = useState({});
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDeckData, setExportDeckData] = useState({ deckName: '', deckItems: {}, deckProducts: [] });
  const [loadingExport, setLoadingExport] = useState(false);
  const [deckMetadata, setDeckMetadata] = useState({});
  const [notification, setNotification] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [deckToDuplicate, setDeckToDuplicate] = useState(null);
  const [loadingDuplicate, setLoadingDuplicate] = useState(false);
  
  // Guard to prevent duplicate API calls
  const loadingDecksRef = useRef(false);
  const lastLoadParamsRef = useRef(null);

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
        .filter(productId => deck.items[productId] > 0)
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
      
      if (productIds.length === 0) {
        metadataMap[deckId] = { colorCounts: {}, marketValue: 0, backgroundImage: null };
        continue;
      }
      
      deckProductMap[deckId] = productIds;
      productIds.forEach(id => allProductIdsSet.add(id));
    }
    
    // Batch fetch all products and prices at once
    const allProductIds = Array.from(allProductIdsSet);
    if (allProductIds.length === 0) {
      setDeckMetadata(metadataMap);
      return;
    }
    
    try {
      // Skip pricing if skipPricing prop is true (e.g., for landing page)
      const fetchPromises = [fetchProductsBulk(allProductIds)];
      if (!skipPricing) {
        fetchPromises.push(
          fetchCurrentPricesBulk(allProductIds).catch(err => {
            console.warn('Failed to fetch prices for decks, continuing without prices:', err);
            return {};
          })
        );
      }
      
      const results = await Promise.all(fetchPromises);
      const allProducts = results[0];
      const allPrices = skipPricing ? {} : results[1];
      
      // Create a map of productId to product for quick lookup
      const productMap = {};
      if (Array.isArray(allProducts)) {
        allProducts.forEach(product => {
          const productId = product.product_id || product.id;
          if (productId) {
            productMap[productId] = product;
          }
        });
      }
      
      // Second pass: process each deck using the batched data
      for (const deck of decks) {
        const deckId = deck.deck_list_id || deck.id;
        if (!deckProductMap[deckId]) continue;
        
        const productIds = deckProductMap[deckId];
        const colorCounts = {};
        let marketValue = 0;
        let highestLevel = -1;
        let highestLevelCardImage = null;
        
        productIds.forEach(productIdInt => {
          const productId = String(productIdInt);
          const product = productMap[productIdInt];
          const quantity = deck.items[productId] || 0;
          
          if (!product || quantity <= 0) return;
          
          const extendedData = extractExtendedDataFromProduct(product);
          let cardLevel = -1;
          let cardColor = null;
          
          extendedData.forEach(item => {
            const key = item.key || item.name;
            const value = item.value || item.val;
            if (key && value) {
              const keyUpper = key.toUpperCase();
              if (keyUpper === 'COLOR') {
                const colorValue = getColorValue(value);
                if (colorValue) {
                  cardColor = colorValue;
                }
              } else if (keyUpper === 'LEVEL') {
                const levelNum = parseInt(value, 10);
                if (!isNaN(levelNum)) {
                  cardLevel = levelNum;
                }
              }
            }
          });
          
          if (cardColor && quantity > 0) {
            colorCounts[cardColor] = (colorCounts[cardColor] || 0) + quantity;
          }
          
          if (cardLevel > highestLevel) {
            highestLevel = cardLevel;
            const imageUrl = product.image_url || product.imageUrl || product.image;
            if (imageUrl) {
              highestLevelCardImage = imageUrl;
            }
          } else if (cardLevel === highestLevel && !highestLevelCardImage) {
            const imageUrl = product.image_url || product.imageUrl || product.image;
            if (imageUrl) {
              highestLevelCardImage = imageUrl;
            }
          }
          
          // Only calculate market value if pricing is enabled
          if (!skipPricing) {
            const price = allPrices[productIdInt];
            const marketPrice = price?.market_price || price?.marketPrice;
            if (marketPrice !== null && marketPrice !== undefined) {
              const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
              if (!isNaN(priceNum)) {
                marketValue += priceNum * quantity;
              }
            }
          }
        });
        
        metadataMap[deckId] = { colorCounts, marketValue, backgroundImage: highestLevelCardImage };
      }
    } catch (err) {
      console.error('Error loading deck metadata:', err);
      // Set empty metadata for all decks on error
      for (const deck of decks) {
        const deckId = deck.deck_list_id || deck.id;
        if (!metadataMap[deckId]) {
          metadataMap[deckId] = { colorCounts: {}, marketValue: 0, backgroundImage: null };
        }
      }
    }
    
    setDeckMetadata(metadataMap);
  }, []);

  const loadDeckLists = useCallback(async (catId) => {
    // If fetching all users' decks, don't require user
    if (!fetchAllUsers && !user) return;
    
    // Create a unique key for this load request
    const loadKey = `${fetchAllUsers ? 'all' : user?.id}_${catId}_${sortBy}_${maxDecks}`;
    
    // Prevent duplicate calls with the same parameters
    if (loadingDecksRef.current) {
      if (lastLoadParamsRef.current === loadKey) {
        // Same parameters, skip (cache will handle the API call)
        return;
      }
      // Different parameters, let it proceed (will be deduplicated by API cache if same API call)
    }
    
    loadingDecksRef.current = true;
    lastLoadParamsRef.current = loadKey;
    
    try {
      setLoadingDecks(true);
      const data = fetchAllUsers 
        ? await fetchAllDeckLists(catId)
        : await fetchDeckLists(user.id, catId);
      let decks = Array.isArray(data) ? data : [];
      
      // Sort by creation date if sortBy is "recent"
      if (sortBy === 'recent') {
        decks = [...decks].sort((a, b) => {
          // Try different possible field names for creation date
          const aDate = a.created_at || a.created_at_timestamp || a.timestamp || a.created || a.date_created || 0;
          const bDate = b.created_at || b.created_at_timestamp || b.timestamp || b.created || b.date_created || 0;
          
          // Convert to numbers if they're strings
          const aTime = typeof aDate === 'string' ? new Date(aDate).getTime() : (aDate || 0);
          const bTime = typeof bDate === 'string' ? new Date(bDate).getTime() : (bDate || 0);
          
          // Sort descending (most recent first)
          return bTime - aTime;
        });
      }
      
      // Limit to maxDecks if specified
      if (maxDecks && maxDecks > 0) {
        decks = decks.slice(0, maxDecks);
      }
      
      setDeckLists(decks);
      
      await loadDeckMetadata(decks);
    } catch (err) {
      console.error('Error loading deck lists:', err);
      setDeckLists([]);
    } finally {
      setLoadingDecks(false);
      loadingDecksRef.current = false;
    }
  }, [user, fetchAllUsers, sortBy, maxDecks, loadDeckMetadata, skipPricing]);

  useEffect(() => {
    if ((fetchAllUsers || user) && categoryId !== null) {
      loadDeckLists(categoryId);
    } else {
      setDeckLists([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, categoryId, sortBy, maxDecks, fetchAllUsers]); // Only depend on primitive values, not the callback

  useEffect(() => {
    loadCategoryRules();
  }, []);

  const loadCategoryRules = async () => {
    try {
      const rulesData = await fetchCategoryRules();
      const rulesMap = {};
      rulesData.forEach(rule => {
        const catId = String(rule.category_id || rule.categoryId || rule.id);
        rulesMap[catId] = rule;
      });
      setCategoryRules(rulesMap);
    } catch (err) {
      console.error('Error loading category rules:', err);
      setCategoryRules({});
    }
  };

  // Convert color name/text to CSS color value
  const getColorValue = (colorText) => {
    if (!colorText) return null;
    
    const color = colorText.trim().toLowerCase();
    
    if (/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
      return color;
    }
    
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
    
    return colorMap[color] || color;
  };

  const handleAddDeck = async () => {
    const trimmedName = newDeckName.trim();
    if (!user || !categoryId || !trimmedName) {
      return;
    }

    try {
      const newDeck = await createDeckList(user.id, categoryId, trimmedName);
      setDeckLists([...deckLists, newDeck]);
      setNewDeckName('');
      setShowAddDeckForm(false);
      
      // Navigate to deck builder
      const deckId = newDeck.deck_list_id || newDeck.id;
      if (onDeckSelect) {
        onDeckSelect(deckId);
      } else {
        navigate(`/deck-builder/${deckId}`);
      }
    } catch (err) {
      console.error('Error creating deck list:', err);
      setNotification({
        isOpen: true,
        title: 'Create Failed',
        message: 'Failed to create deck. Please try again.',
        type: 'error'
      });
    }
  };

  const handleStartEdit = (deckList) => {
    setEditingDeckId(deckList.deck_list_id || deckList.id);
    setEditingName(deckList.name || '');
  };

  const handleSaveEdit = async (deckListId) => {
    if (!user || !editingName.trim()) {
      return;
    }

    try {
      const updated = await updateDeckListName(deckListId, user.id, editingName.trim());
      setDeckLists(deckLists.map(deck => 
        (deck.deck_list_id || deck.id) === deckListId ? updated : deck
      ));
      setEditingDeckId(null);
      setEditingName('');
    } catch (err) {
      console.error('Error updating deck list name:', err);
      setNotification({
        isOpen: true,
        title: 'Update Failed',
        message: 'Failed to update deck name. Please try again.',
        type: 'error'
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingDeckId(null);
    setEditingName('');
  };

  const handleDeleteDeck = async (deckListId) => {
    if (!user) return;
    
    setConfirmation({
      isOpen: true,
      title: 'Delete Deck',
      message: 'Are you sure you want to delete this deck? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDeckList(deckListId, user.id);
          setDeckLists(deckLists.filter(deck => (deck.deck_list_id || deck.id) !== deckListId));
          setNotification({
            isOpen: true,
            title: 'Deck Deleted',
            message: 'The deck has been successfully deleted.',
            type: 'success'
          });
          setConfirmation({ isOpen: false, title: '', message: '', onConfirm: null });
        } catch (err) {
          console.error('Error deleting deck list:', err);
          setNotification({
            isOpen: true,
            title: 'Delete Failed',
            message: 'Failed to delete deck. Please try again.',
            type: 'error'
          });
          setConfirmation({ isOpen: false, title: '', message: '', onConfirm: null });
        }
      }
    });
  };

  const handleDeckSelect = (deckId) => {
    if (onDeckSelect) {
      onDeckSelect(deckId);
    } else {
      navigate(`/deck-builder/${deckId}`);
    }
  };

  const handleExportDeck = async (deck) => {
    const deckId = deck.deck_list_id || deck.id;
    setLoadingExport(true);
    
    try {
      const fullDeck = await fetchDeckList(deckId, user?.id || null);
      if (!fullDeck) {
        setNotification({
          isOpen: true,
          title: 'Load Failed',
          message: 'Failed to load deck data',
          type: 'error'
        });
        return;
      }

      const productIds = Object.keys(fullDeck.items || {})
        .filter(productId => fullDeck.items[productId] > 0)
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));

      let products = [];
      if (productIds.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < productIds.length; i += batchSize) {
          const batch = productIds.slice(i, i + batchSize);
          const batchProducts = await fetchProductsBulk(batch);
          products.push(...batchProducts);
        }
      }

      setExportDeckData({
        deckName: fullDeck.name || 'Untitled Deck',
        deckItems: fullDeck.items || {},
        deckProducts: products
      });
      setShowExportModal(true);
    } catch (err) {
      console.error('Error loading deck for export:', err);
      setNotification({
        isOpen: true,
        title: 'Export Failed',
        message: 'Failed to load deck data for export',
        type: 'error'
      });
    } finally {
      setLoadingExport(false);
    }
  };

  const handleDuplicateDeck = async (deck) => {
    if (!user || !categoryId) return;
    
    setDeckToDuplicate(deck);
    setShowDuplicateModal(true);
  };

  const handleConfirmDuplicate = async (newDeckName) => {
    if (!user || !categoryId || !deckToDuplicate) return;
    
    setLoadingDuplicate(true);
    
    try {
      const deckId = deckToDuplicate.deck_list_id || deckToDuplicate.id;
      
      // Fetch the full deck data to get all items
      const fullDeck = await fetchDeckList(deckId, user.id);
      if (!fullDeck) {
        setNotification({
          isOpen: true,
          title: 'Duplicate Failed',
          message: 'Failed to load deck data',
          type: 'error'
        });
        setShowDuplicateModal(false);
        setDeckToDuplicate(null);
        return;
      }

      // Create new deck with the same items
      const newDeck = await createDeckList(user.id, categoryId, newDeckName, fullDeck.items || {});
      
      // Update the new deck with all items from the original deck
      if (fullDeck.items && Object.keys(fullDeck.items).length > 0) {
        const newDeckId = newDeck.deck_list_id || newDeck.id;
        await updateDeckListItems(newDeckId, user.id, fullDeck.items);
      }

      // Force a fresh reload by resetting the loading refs
      loadingDecksRef.current = false;
      lastLoadParamsRef.current = null;
      
      // Reload deck lists to show the new deck
      await loadDeckLists(categoryId);
      
      setNotification({
        isOpen: true,
        title: 'Deck Duplicated',
        message: `Deck "${newDeckName}" has been created successfully.`,
        type: 'success'
      });
      
      setShowDuplicateModal(false);
      setDeckToDuplicate(null);
    } catch (err) {
      console.error('Error duplicating deck:', err);
      setNotification({
        isOpen: true,
        title: 'Duplicate Failed',
        message: 'Failed to duplicate deck. Please try again.',
        type: 'error'
      });
    } finally {
      setLoadingDuplicate(false);
    }
  };

  // Allow rendering if fetching all users' decks, otherwise require user
  if (!fetchAllUsers && !user) {
    return null;
  }

  return (
    <>
      <div className="decks-section">
        {loadingDecks ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading decks...</p>
          </div>
        ) : (
          <div className="decks-list">
            {deckLists.map((deck) => {
              const deckId = deck.deck_list_id || deck.id;
              const isEditing = editingDeckId === deckId;
              
              return (
                <div 
                  key={deckId} 
                  className={`deck-item ${isEditing ? 'deck-item-editing' : ''}`}
                  style={(() => {
                    const metadata = deckMetadata[deckId];
                    const bgImage = metadata?.backgroundImage;
                    if (bgImage && !isEditing) {
                      return {
                        backgroundImage: `url(${bgImage})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat'
                      };
                    }
                    return {};
                  })()}
                  onClick={(e) => {
                    if (!isEditing && !e.target.closest('button') && !e.target.closest('input')) {
                      handleDeckSelect(deckId);
                    }
                  }}
                >
                  {isEditing ? (
                    <div className="deck-edit-form" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        className="deck-name-input"
                        value={editingName}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingName(e.target.value);
                        }}
                        onKeyPress={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            handleSaveEdit(deckId);
                          } else if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      <div className="deck-edit-actions">
                        <button
                          className="save-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveEdit(deckId);
                          }}
                          disabled={!editingName.trim()}
                        >
                          Save
                        </button>
                        <button
                          className="cancel-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelEdit();
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="deck-meta-info">
                        {showUsername && deck.username && (
                          <div className="deck-username">
                            @{deck.username}
                          </div>
                        )}
                        {(() => {
                          // Format created date
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
                            } catch (e) {
                              // Invalid date, leave empty
                            }
                          }
                          
                          return formattedDate ? (
                            <div className="deck-created-date">
                              {formattedDate}
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {(() => {
                        const metadata = deckMetadata[deckId];
                        if (!metadata) return null;
                        
                        const colorCounts = metadata.colorCounts || {};
                        const totalCards = Object.values(colorCounts).reduce((sum, count) => sum + count, 0);
                        const colorEntries = Object.entries(colorCounts)
                          .map(([color, count]) => ({
                            color,
                            count,
                            proportion: totalCards > 0 ? count / totalCards : 0
                          }))
                          .sort((a, b) => b.count - a.count);
                        
                        if (colorEntries.length === 0) return null;
                        
                        return (
                          <div className="deck-color-pie-chart">
                            <svg width="100" height="100" viewBox="0 0 40 40" className="pie-chart-svg">
                              <circle
                                cx="20"
                                cy="20"
                                r="18"
                                fill="none"
                                stroke="#e2e8f0"
                                strokeWidth="4"
                              />
                              {(() => {
                                let currentAngle = -90;
                                return colorEntries.map(({ color, proportion }, idx) => {
                                  const colorValue = getColorValue(color);
                                  const angle = proportion * 360;
                                  const largeArcFlag = proportion > 0.5 ? 1 : 0;
                                  
                                  const startAngle = currentAngle;
                                  const endAngle = currentAngle + angle;
                                  
                                  const x1 = 20 + 18 * Math.cos((startAngle * Math.PI) / 180);
                                  const y1 = 20 + 18 * Math.sin((startAngle * Math.PI) / 180);
                                  const x2 = 20 + 18 * Math.cos((endAngle * Math.PI) / 180);
                                  const y2 = 20 + 18 * Math.sin((endAngle * Math.PI) / 180);
                                  
                                  const pathData = [
                                    `M 20 20`,
                                    `L ${x1} ${y1}`,
                                    `A 18 18 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                                    `Z`
                                  ].join(' ');
                                  
                                  currentAngle += angle;
                                  
                                  return (
                                    <path
                                      key={idx}
                                      d={pathData}
                                      fill={colorValue || '#cbd5e0'}
                                      stroke="#ffffff"
                                      strokeWidth="1"
                                      title={`${color}: ${Math.round(proportion * 100)}%`}
                                    />
                                  );
                                });
                              })()}
                            </svg>
                          </div>
                        );
                      })()}
                      <div className="deck-info-wrapper">
                        <div className="deck-info">
                          <div className="deck-name-row">
                            <div className="deck-name">
                              {deck.name || 'Unnamed Deck'}
                            </div>
                            {user && (deck.user_id === user.id || deck.userId === user.id) && (
                              <button
                                className="edit-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEdit(deck);
                                }}
                                title="Rename deck"
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                          <div className="deck-stats-row">
                            <div className={`deck-card-count ${(() => {
                              const deckCategoryId = String(deck.category_id || deck.categoryId);
                              const cardCount = deck.card_count || 0;
                              const rules = categoryRules[deckCategoryId];
                              
                              if (rules && rules.deck_size && cardCount > rules.deck_size) {
                                return 'deck-over-limit';
                              }
                              return '';
                            })()}`}>
                              {(() => {
                                const deckCategoryId = String(deck.category_id || deck.categoryId);
                                const cardCount = deck.card_count || 0;
                                const rules = categoryRules[deckCategoryId];
                                
                                if (rules && rules.deck_size) {
                                  const isOverLimit = cardCount > rules.deck_size;
                                  return (
                                    <>
                                      {cardCount} / {rules.deck_size} card{rules.deck_size !== 1 ? 's' : ''}
                                      {isOverLimit && (
                                        <span className="over-limit-indicator" title={`Deck exceeds limit by ${cardCount - rules.deck_size} card${cardCount - rules.deck_size !== 1 ? 's' : ''}`}>
                                          {' '}⚠️
                                        </span>
                                      )}
                                    </>
                                  );
                                } else {
                                  return `${cardCount} card${cardCount !== 1 ? 's' : ''}`;
                                }
                              })()}
                            </div>
                            {!skipPricing && (() => {
                              const metadata = deckMetadata[deckId];
                              const marketValue = metadata?.marketValue || 0;
                              
                              if (marketValue > 0) {
                                return (
                                  <div className="deck-market-value">
                                    ${marketValue.toFixed(2)}
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="deck-actions">
                        {user && (deck.user_id === user.id || deck.userId === user.id) && (
                          <>
                            <button
                              className="duplicate-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateDeck(deck);
                              }}
                              title="Duplicate deck"
                              disabled={loadingDuplicate}
                            >
                            <RiFileCopyFill />

                            </button>
                            <button
                              className="export-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportDeck(deck);
                              }}
                              title="Export deck"
                              disabled={loadingExport}
                            >
                              📤
                            </button>
                            <button
                              className="delete-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteDeck(deckId);
                              }}
                              title="Delete deck"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {showAddDeck && (
              <>
                {addDeckRedirect ? (
                  <div 
                    className="deck-item add-deck-item"
                    onClick={() => navigate(addDeckRedirect)}
                  >
                    <div className="deck-info">
                      <div className="deck-name add-deck-name">
                        + Add Deck
                      </div>
                    </div>
                  </div>
                ) : !showAddDeckForm ? (
                  <div 
                    className="deck-item add-deck-item"
                    onClick={() => {
                      setShowAddDeckForm(true);
                      setNewDeckName('');
                    }}
                  >
                    <div className="deck-info">
                      <div className="deck-name add-deck-name">
                        + Add Deck
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="deck-item add-deck-form-item" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      className="deck-name-input"
                      placeholder="Enter deck name..."
                      value={newDeckName}
                      onChange={(e) => {
                        e.stopPropagation();
                        setNewDeckName(e.target.value);
                      }}
                      onKeyPress={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          handleAddDeck();
                        } else if (e.key === 'Escape') {
                          setShowAddDeckForm(false);
                          setNewDeckName('');
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    <div className="add-deck-actions">
                      <button
                        className="save-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddDeck();
                        }}
                        disabled={!newDeckName.trim()}
                      >
                        Create
                      </button>
                      <button
                        className="cancel-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAddDeckForm(false);
                          setNewDeckName('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <ExportDeckModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        deckName={exportDeckData.deckName}
        deckItems={exportDeckData.deckItems}
        deckProducts={exportDeckData.deckProducts}
        canEdit={false}
        showPrepopulate={true}
        showMSAButton={true}
        showCopyButton={true}
      />

      <NotificationModal
        isOpen={notification.isOpen}
        onClose={() => setNotification({ isOpen: false, title: '', message: '', type: 'info' })}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />

      <ConfirmationModal
        isOpen={confirmation.isOpen}
        onClose={() => setConfirmation({ isOpen: false, title: '', message: '', onConfirm: null })}
        onConfirm={confirmation.onConfirm}
        title={confirmation.title}
        message={confirmation.message}
      />

      <DeckNamePromptModal
        isOpen={showDuplicateModal}
        onClose={() => {
          setShowDuplicateModal(false);
          setDeckToDuplicate(null);
        }}
        onConfirm={handleConfirmDuplicate}
        title="Duplicate Deck"
        message="Enter a name for the duplicated deck:"
        defaultValue={deckToDuplicate ? `Copy of ${deckToDuplicate.name || 'Untitled Deck'}` : ''}
      />
    </>
  );
};

export default DecksSection;

