import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useTCGPercentage } from '../contexts/TCGPercentageContext';
import { getFavorites, toggleFavorite } from '../lib/favorites';
import { getUserInventory, bulkUpdateInventory } from '../lib/inventory';
import { fetchGroupsByCategory, fetchProductExtendedDataKeyValues, filterProducts, searchProducts, fetchProductsBulk, extractExtendedDataFromProduct, fetchCurrentPricesBulk } from '../lib/api';
import { parseImportText, fetchProductsByCardNumbers, matchProductsToImportLines } from '../lib/importUtils';
import { calculateDelta as calculateDeltaUtil } from '../lib/deltaUtils';
import { applyImportAdditive, applyRemoval, getMergedItems } from '../lib/stagingUtils';
import { buildSidebarItems } from '../lib/sidebarUtils';
import NavigationBar from './NavigationBar';
import ProductPreviewModal from './ProductPreviewModal';
import NotificationModal from './NotificationModal';
import ConfirmationModal from './ConfirmationModal';
import ExportDeckModal from './ExportDeckModal';
import PageHeader from './PageHeader';
import ProductListingContent from './ProductListingContent';
import SidebarCardList from './SidebarCardList';
import DistributionHistograms from './DistributionHistograms';
import DeckDeltaConfirmation from './DeckDeltaConfirmation';
import './ProductsPage.css';

const ProductsPage = () => {
  const { categoryId: categoryIdParam } = useParams();
  // Use categoryId from params if available, otherwise default to 86 for /inventory route
  const categoryId = categoryIdParam || '86';
  const { user } = useAuth();
  const { selectedCurrency, setSelectedCurrency, currencyRates, loadingRates } = useCurrency();
  const { selectedTCGPercentage } = useTCGPercentage();
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  // Single source of truth: products map keyed by product_id
  // This ensures all loaded products (from filter, import, etc.) are available everywhere
  const [productsMap, setProductsMap] = useState({}); // { productId: product }
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [categoryKeys, setCategoryKeys] = useState([]);
  const [attributeFilters, setAttributeFilters] = useState({});
  const [pendingAttributeFilters, setPendingAttributeFilters] = useState({});
  const [attributeValues, setAttributeValues] = useState({});
  const [showAttributeFilters, setShowAttributeFilters] = useState(false);
  const [collapsedAttributeGroups, setCollapsedAttributeGroups] = useState({});
  const [categoryAttributesCache, setCategoryAttributesCache] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('name-asc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState(new Set());
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [inventory, setInventory] = useState({}); // { product_id: quantity } map
  const [stagedInventory, setStagedInventory] = useState({}); // Staged inventory changes
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(true); // Start as true to trigger initial load
  const [newlyAddedProductIds, setNewlyAddedProductIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingAttributes, setLoadingAttributes] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [productExtendedData, setProductExtendedData] = useState({});
  const [productPrices, setProductPrices] = useState({});
  const [inventoryProductPrices, setInventoryProductPrices] = useState({}); // Prices for sidebar products
  const [previewProductId, setPreviewProductId] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [notification, setNotification] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [showExportModal, setShowExportModal] = useState(false);
  const [histogramTab, setHistogramTab] = useState('cardType'); // 'cardType', 'market'
  const [histogramsMinimized, setHistogramsMinimized] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  // Initialize maxPercentage with user's TCG percentage preference, or default to 100
  const [maxPercentage, setMaxPercentage] = useState(() => {
    const value = selectedTCGPercentage;
    return (value !== null && value !== undefined && !isNaN(value)) ? value : 100;
  });
  const [showDeltaConfirmation, setShowDeltaConfirmation] = useState(false);
  const [isUpdatingInventory, setIsUpdatingInventory] = useState(false);
  
  const loadingProductsRef = useRef(false);
  const loadingGroupsRef = useRef(false);
  const loadingAttributesRef = useRef(false);
  const loadingInventoryRef = useRef(false);
  const loadingAllProductsRef = useRef(false);
  const lastCategoryIdRef = useRef(null);
  const prevFilterStateRef = useRef({});
  const scrollPositionRef = useRef(0);

  // Define functions with useCallback to avoid dependency issues
  const loadInventory = useCallback(async () => {
    if (!user || loadingInventoryRef.current) {
      console.log('loadInventory: Skipping - user:', user, 'loading:', loadingInventoryRef.current);
      return;
    }
    
    try {
      loadingInventoryRef.current = true;
      console.log('loadInventory: Fetching inventory for user:', user.id);
      const inv = await getUserInventory(user.id);
      console.log('loadInventory: Received inventory:', inv);
      setInventory(inv);
    } catch (err) {
      console.error('Error loading inventory:', err);
      setInventory({});
    } finally {
      loadingInventoryRef.current = false;
    }
  }, [user]);

  const loadFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const favs = await getFavorites(user.id);
      setFavorites(favs);
    } catch (err) {
      console.error('Error loading favorites:', err);
      setFavorites(new Set());
    }
  }, [user]);

  const loadGroups = useCallback(async () => {
    if (!categoryId) return;
    if (loadingGroupsRef.current) return;

    try {
      loadingGroupsRef.current = true;
      setLoadingGroups(true);
      const data = await fetchGroupsByCategory(parseInt(categoryId, 10));
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading groups:', err);
      setGroups([]);
    } finally {
      setLoadingGroups(false);
      loadingGroupsRef.current = false;
    }
  }, [categoryId]);

  const loadAttributes = useCallback(async () => {
    if (!categoryId) return;
    if (loadingAttributesRef.current) return;
    
    const catId = String(categoryId);
    if (categoryAttributesCache[catId]) {
      const cached = categoryAttributesCache[catId];
      setCategoryKeys(cached.keys || []);
      setAttributeValues(cached.values || {});
      setLoadingAttributes(false);
      return;
    }

    try {
      loadingAttributesRef.current = true;
      setLoadingAttributes(true);
      const keyValuesData = await fetchProductExtendedDataKeyValues(parseInt(categoryId, 10));
      
      const validKeys = [];
      const valuesObj = {};
      
      // Handle array response format
      if (Array.isArray(keyValuesData)) {
        keyValuesData.forEach(item => {
          const key = item.key || item.name;
          const values = item.values || [];
          if (key && values.length > 0) {
            validKeys.push(key);
            valuesObj[key] = values;
          }
        });
      } else {
        // Handle object response format with keys and key_value_pairs
        const keyValuePairs = keyValuesData.key_value_pairs || keyValuesData.keyValuePairs || {};
        const keys = keyValuesData.keys || Object.keys(keyValuePairs);
        
        // Define keys to exclude
        const excludedKeys = ['DESCRIPTION', 'TRIGGER', 'EFFECT', 'SUBTYPES', 'NUMBER', 'LINK CONDITION'];
        
        // Define the desired sort order for attributes
        const attributeOrder = [
          'Color',
          'CardType',
          'Cost',
          'Level',
          'Rarity',
          'Trait',
          'Hit Points',
          'Attack Points'
        ];
        
        const validKeysMap = new Map(); // Use Map to preserve insertion order
        
        // First, collect valid keys (excluding textual and excluded keys)
        keys.forEach(key => {
          const keyUpper = key.toUpperCase();
          if (excludedKeys.some(excludedKey => keyUpper === excludedKey.toUpperCase())) {
            return;
          }
          
          const values = (keyValuePairs[key] || []).filter(value => 
            value && value.length <= 40
          );
          
          if (values.length > 0) {
            valuesObj[key] = values;
            validKeysMap.set(key, key);
          }
        });
        
        // Sort keys according to the specified order
        const sortedKeys = [];
        
        // First, add keys in the specified order
        attributeOrder.forEach(orderedKey => {
          // Try to find matching key (case-insensitive)
          for (const [actualKey] of validKeysMap) {
            if (actualKey.toUpperCase() === orderedKey.toUpperCase()) {
              sortedKeys.push(actualKey);
              validKeysMap.delete(actualKey);
              break;
            }
          }
        });
        
        // Then add any remaining keys that weren't in the order list
        const remainingKeys = Array.from(validKeysMap.keys()).sort();
        sortedKeys.push(...remainingKeys);
        
        validKeys.push(...sortedKeys);
      }
      
      setCategoryKeys(validKeys);
      setAttributeValues(valuesObj);
      setCategoryAttributesCache(prev => ({
      ...prev,
        [catId]: { keys: validKeys, values: valuesObj }
      }));
    } catch (err) {
      console.error('Error loading attributes:', err);
      setCategoryKeys([]);
      setAttributeValues({});
    } finally {
      setLoadingAttributes(false);
      loadingAttributesRef.current = false;
    }
  }, [categoryId, categoryAttributesCache]);

  const loadProducts = useCallback(async (page = 1, append = false) => {
    if (!categoryId) return;
    if (loadingProductsRef.current && !append) return; // Allow loading more pages

    try {
      if (!append) {
        loadingProductsRef.current = true;
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      
      let productsData = [];
      let total = 0;
      let pageNum = page;
      let pageSize = 64;
      let hasMore = false;
      
      // Check if we have a search query - use search endpoint
      if (searchQuery && searchQuery.trim()) {
        const searchParams = {
          q: searchQuery.trim(),
          page: page,
          limit: 64
        };
        
        const response = await searchProducts(searchParams);
        
        if (response && typeof response === 'object') {
          // Extract products - API returns data in 'data' field per PaginatedResponse contract
          if (response.data && Array.isArray(response.data)) {
            productsData = response.data;
          } else if (response.products && Array.isArray(response.products)) {
            productsData = response.products;
          } else if (response.results && Array.isArray(response.results)) {
            productsData = response.results;
          } else if (Array.isArray(response)) {
            productsData = response;
          }
          
          // Extract pagination info per API contract: { data, page, limit, total, has_more }
          total = response.total !== null && response.total !== undefined ? response.total : 0;
          pageNum = response.page || page;
          pageSize = response.limit || 64;
          hasMore = response.has_more === true;
        }
        
        // Filter by category if needed (search may return products from all categories)
        if (categoryId && productsData.length > 0) {
          const categoryIdInt = parseInt(categoryId, 10);
          productsData = productsData.filter(p => {
            const productCategoryId = p.category_id || p.categoryId;
            return productCategoryId === categoryIdInt;
          });
          total = productsData.length;
        }
      }
      // Check if we're filtering by favorites or owned - use bulk endpoint
      else if (showFavoritesOnly || showOwnedOnly) {
        // Collect all product IDs we need
        const productIds = new Set();
        
        if (showFavoritesOnly && favorites.size > 0) {
          favorites.forEach(productId => productIds.add(parseInt(productId, 10)));
        }
        
        if (showOwnedOnly && Object.keys(inventory).length > 0) {
          Object.keys(inventory).forEach(productId => {
            if ((inventory[productId] || 0) > 0) {
              productIds.add(parseInt(productId, 10));
            }
          });
        }
        
        if (productIds.size > 0) {
          // Fetch all products at once using bulk endpoint
          const productIdsArray = Array.from(productIds);
          productsData = await fetchProductsBulk(productIdsArray);
          total = productsData.length;
          pageNum = 1;
          hasMore = false; // We loaded everything, no more pages
          
          // Filter by category if needed (products from bulk may not be filtered by category)
          if (categoryId) {
            const categoryIdInt = parseInt(categoryId, 10);
            productsData = productsData.filter(p => {
              const productCategoryId = p.category_id || p.categoryId;
              return productCategoryId === categoryIdInt;
            });
            total = productsData.length;
          }
        } else {
          // No products match the filter
          productsData = [];
          total = 0;
          hasMore = false;
        }
      } else {
        // Normal pagination flow using filter endpoint
        // When searching, use a larger page size to reduce network calls
        const pageLimit = searchQuery && searchQuery.trim() ? 1000 : 64;
        const filterParams = {
          category_id: parseInt(categoryId, 10),
          group_id: selectedGroupId,
          filters: attributeFilters,
          sort_by: sortOption.includes('name') ? 'name' : 'product_id',
          sort_order: sortOption.includes('desc') ? 'desc' : 'asc',
          page: page,
          limit: pageLimit  // Use larger limit when searching
        };

        const response = await filterProducts(filterParams);
        
        if (response && typeof response === 'object') {
          // Extract products - API returns data in 'data' field per PaginatedResponse contract
          if (response.data && Array.isArray(response.data)) {
            productsData = response.data;
          } else if (response.products && Array.isArray(response.products)) {
            productsData = response.products;
          } else if (response.results && Array.isArray(response.results)) {
            productsData = response.results;
          } else if (Array.isArray(response)) {
            productsData = response;
          }
          
          // Extract pagination info per API contract: { data, page, limit, total, has_more }
          total = response.total !== null && response.total !== undefined ? response.total : 0;
          pageNum = response.page || page;
          pageSize = response.limit || 64;  // API returns 'limit' not 'page_size'
          hasMore = response.has_more === true;  // Use API's has_more field
        }

        // If total is null/0 but we have products, estimate total from current page
        if (total === 0 && productsData.length > 0) {
          total = pageNum * pageSize + (productsData.length < pageSize ? 0 : 1);
        }
      }

      if (append) {
        // Append new products to existing list, filtering out duplicates
        setProducts(prev => {
          // Create a Set of existing product IDs for quick lookup
          const existingIds = new Set(
            prev.map(p => String(p.product_id || p.id))
          );
          
          // Filter out products that already exist
          const newProducts = productsData.filter(p => {
            const productId = String(p.product_id || p.id);
            return !existingIds.has(productId);
          });
          
          const updatedProducts = [...prev, ...newProducts];
          // Use API's has_more field if available, otherwise calculate from total
          const itemsLoaded = updatedProducts.length;
          const calculatedHasMore = total > 0 ? itemsLoaded < total : hasMore;
          // Track if this load actually added products (not just duplicates)
          const actuallyAddedProducts = newProducts.length > 0;
          console.log('loadProducts (append):', {
            productsDataLength: productsData.length,
            newProductsLength: newProducts.length,
            pageSize,
            itemsLoaded,
            total,
            hasMoreFromAPI: hasMore,
            calculatedHasMore,
            pageNum,
            actuallyAddedProducts
          });
          // Use API's has_more if available, otherwise use calculated value
          // Only set hasMorePages if we actually got products or haven't reached total
          setHasMorePages(calculatedHasMore && actuallyAddedProducts);
          
          // Track newly added product IDs for animation
          if (newProducts.length > 0) {
            const newProductIds = new Set(
              newProducts.map(p => String(p.product_id || p.id))
            );
            setNewlyAddedProductIds(newProductIds);
            
            // Clear animation class after animation completes
            setTimeout(() => {
              setNewlyAddedProductIds(new Set());
            }, 600); // Match animation duration
          }
          
          return updatedProducts;
        });
      } else {
        // Replace products (new search/filter)
        setProducts(productsData);
        // Use API's has_more field if available, otherwise calculate from total
        const itemsLoaded = productsData.length;
        const calculatedHasMore = total > 0 ? itemsLoaded < total : hasMore;
        console.log('loadProducts (replace):', {
          productsDataLength: productsData.length,
          pageSize,
          itemsLoaded,
          total,
          hasMoreFromAPI: hasMore,
          calculatedHasMore,
          pageNum
        });
        // Use API's has_more if available, otherwise use calculated value
        setHasMorePages(calculatedHasMore);
        
        // Track all products as newly added for fade-in animation
        if (productsData.length > 0) {
          const newProductIds = new Set(
            productsData.map(p => String(p.product_id || p.id))
          );
          setNewlyAddedProductIds(newProductIds);
          
          // Clear animation class after animation completes
          setTimeout(() => {
            setNewlyAddedProductIds(new Set());
          }, 600); // Match animation duration
        } else {
          // Reset newly added IDs when no products
          setNewlyAddedProductIds(new Set());
        }
      }
      
      setTotalCount(total);
      setCurrentPage(pageNum);
      
      // Merge products into the map (single source of truth)
      mergeProductsIntoMap(productsData);
      
      // Load extended data and prices for products
      loadProductExtendedData(productsData);
      
      if (productsData.length > 0) {
        const productIds = productsData
          .map(p => p.product_id || p.id)
          .filter(id => id !== undefined && id !== null);
        
        if (productIds.length > 0) {
          try {
            // Batch price requests if we have many products (API might have limits)
            const BATCH_SIZE = 500;
            const pricePromises = [];
            for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
              const batch = productIds.slice(i, i + BATCH_SIZE);
              pricePromises.push(fetchCurrentPricesBulk(batch));
            }
            const priceResults = await Promise.all(pricePromises);
            // Merge all price results
            const allPrices = {};
            priceResults.forEach(prices => {
              Object.assign(allPrices, prices);
            });
            
            if (append) {
              // Merge with existing prices when appending
              setProductPrices(prev => ({ ...prev, ...allPrices }));
            } else {
              // Replace prices when replacing products (new search/filter)
              setProductPrices(allPrices);
            }
          } catch (err) {
            console.error('Error loading prices:', err);
          }
        }
      } else if (!append) {
        // Clear prices when products list is empty and we're not appending
        setProductPrices({});
      }
    } catch (err) {
      console.error('Error loading products:', err);
      if (!append) {
        setProducts([]);
        setError(err.message || 'Failed to load products');
      }
    } finally {
      if (!append) {
        setLoading(false);
        loadingProductsRef.current = false;
      } else {
        setLoadingMore(false);
      }
    }
  }, [categoryId, selectedGroupId, attributeFilters, sortOption, showFavoritesOnly, showOwnedOnly, favorites, inventory, searchQuery]);

  const loadMoreProducts = useCallback(async () => {
    if (loadingMore || !hasMorePages) {
      return;
    }
    const nextPage = currentPage + 1;
    await loadProducts(nextPage, true);
  }, [loadingMore, hasMorePages, currentPage, loadProducts]);

  // Helper function to merge products into the products map (single source of truth)
  const mergeProductsIntoMap = useCallback((productsToMerge) => {
    if (!Array.isArray(productsToMerge) || productsToMerge.length === 0) return;
    
    setProductsMap(prev => {
      const updated = { ...prev };
      productsToMerge.forEach(product => {
        const productId = String(product.product_id || product.id);
        if (productId) {
          // Update if exists, add if new - ensures we always have the latest data
          updated[productId] = product;
        }
      });
      return updated;
    });
  }, []);

  const loadAllProductsForSidebar = useCallback(async () => {
    if (!categoryId) return;
    if (loadingAllProductsRef.current) return;

    try {
      loadingAllProductsRef.current = true;
      const filterParams = {
        category_id: parseInt(categoryId, 10),
        filters: {},
        sort_by: 'name',
        sort_order: 'asc'
      };

      const response = await filterProducts(filterParams);
      let productsData = [];
      
      if (response && typeof response === 'object') {
        if (response.data && Array.isArray(response.data)) {
          productsData = response.data;
        } else if (response.products && Array.isArray(response.products)) {
          productsData = response.products;
        } else if (response.results && Array.isArray(response.results)) {
          productsData = response.results;
        } else if (Array.isArray(response)) {
          productsData = response;
        }
      }

      // Merge into products map instead of replacing allProducts
      mergeProductsIntoMap(productsData);
      loadProductExtendedData(productsData);
    } catch (err) {
      console.error('Error loading all products:', err);
    } finally {
      loadingAllProductsRef.current = false;
    }
  }, [categoryId, mergeProductsIntoMap]);

  const loadPricesForInventoryProducts = useCallback(async () => {
    const allProductsArray = Object.values(productsMap);
    if (allProductsArray.length === 0) return;
    
    const productIds = allProductsArray
      .map(p => p.product_id || p.id)
      .filter(id => id !== undefined && id !== null);
    
    if (productIds.length === 0) return;
    
    try {
      const prices = await fetchCurrentPricesBulk(productIds);
      setInventoryProductPrices(prices);
    } catch (err) {
      console.error('Error loading inventory prices:', err);
    }
  }, [productsMap]);

  const filterAndSortProducts = useCallback(() => {
    // Preserve scroll position before filtering
    const scrollY = window.scrollY || window.pageYOffset;
    scrollPositionRef.current = scrollY;

    let filtered = [...products];

    // Search filter (client-side) - partial match where order matters (starts with)
    // Searches by name first, then falls back to number attribute
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(product => {
        const name = (product.name || '').toLowerCase();
        if (name.startsWith(query)) {
          return true;
        }
        // Fallback: search by number attribute
        const number = String(product.Number || product.number || '').toLowerCase();
        return number.startsWith(query);
      });
    }

    // Favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter(product => {
        const productId = String(product.product_id || product.id);
        return favorites.has(productId);
      });
    }

    // Owned filter
    if (showOwnedOnly) {
      filtered = filtered.filter(product => {
        const productId = String(product.product_id || product.id);
        return (inventory[productId] || 0) > 0;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortOption.includes('name')) {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        return sortOption.includes('desc') 
          ? bName.localeCompare(aName)
          : aName.localeCompare(bName);
      } else {
        const aId = a.product_id || a.id || 0;
        const bId = b.product_id || b.id || 0;
        return sortOption.includes('desc') ? bId - aId : aId - bId;
      }
    });

    setFilteredProducts(filtered);
    
    // Reset displayedCount if filter parameters actually changed
    const currentFilterState = {
      searchQuery,
      showFavoritesOnly,
      showOwnedOnly,
      sortOption,
      attributeFilters: JSON.stringify(attributeFilters), // Stringify for comparison
      productsLength: products.length
    };
    
    const prevState = prevFilterStateRef.current;
    
    // Reset if any filter changed or products list was replaced
    const shouldReset = 
      currentFilterState.searchQuery !== prevState.searchQuery ||
      currentFilterState.showFavoritesOnly !== prevState.showFavoritesOnly ||
      currentFilterState.showOwnedOnly !== prevState.showOwnedOnly ||
      currentFilterState.sortOption !== prevState.sortOption ||
      currentFilterState.attributeFilters !== prevState.attributeFilters ||
      (prevState.productsLength === 0 && currentFilterState.productsLength > 0) ||
      (prevState.productsLength > 0 && currentFilterState.productsLength === 0);
    
    if (shouldReset) {
      setCurrentPage(1);
      loadProducts(1, false);
    }
    
    // Always update the ref to track current state
    prevFilterStateRef.current = currentFilterState;
    
    // Restore scroll position after DOM updates if we didn't reset
    if (!shouldReset && scrollPositionRef.current > 0) {
      const savedScroll = scrollPositionRef.current;
      requestAnimationFrame(() => {
        window.scrollTo(0, savedScroll);
        setTimeout(() => {
          window.scrollTo(0, savedScroll);
        }, 0);
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScroll);
        });
      });
    }
  }, [products, searchQuery, showFavoritesOnly, showOwnedOnly, favorites, inventory, sortOption, attributeFilters]);

  const loadData = useCallback(async () => {
    if (!categoryId) return;
    setCurrentPage(1);
    await Promise.all([
      loadGroups(),
      loadAttributes(),
      loadAllProductsForSidebar()
    ]);
    // Trigger initial load - sentinel will handle subsequent loads
    if (products.length === 0 && hasMorePages) {
      loadProducts(1, false);
    }
  }, [categoryId, loadGroups, loadAttributes, loadAllProductsForSidebar, products.length, hasMorePages, loadProducts]);

  // Sync maxPercentage with user's TCG percentage preference
  useEffect(() => {
    if (selectedTCGPercentage !== null && selectedTCGPercentage !== undefined && !isNaN(selectedTCGPercentage)) {
      setMaxPercentage(selectedTCGPercentage);
    } else {
      setMaxPercentage(100);
    }
  }, [selectedTCGPercentage]);

  useEffect(() => {
    if (categoryId && categoryId !== lastCategoryIdRef.current) {
      lastCategoryIdRef.current = categoryId;
      loadData();
    }
  }, [categoryId, loadData]);

  useEffect(() => {
    if (user) {
      loadInventory();
      loadFavorites();
    }
  }, [user, loadInventory, loadFavorites]);

  useEffect(() => {
    if (categoryId) {
      loadAttributes();
    }
  }, [categoryId, loadAttributes]);

  useEffect(() => {
    if (categoryId) {
      setCurrentPage(1);
      loadProducts(1, false);
    }
  }, [categoryId, loadProducts]);

  useEffect(() => {
    if (categoryId) {
      loadAllProductsForSidebar();
    }
  }, [categoryId, loadAllProductsForSidebar]);

  useEffect(() => {
    filterAndSortProducts();
  }, [filterAndSortProducts]);

  useEffect(() => {
    const allProductsArray = Object.values(productsMap);
    if (allProductsArray.length > 0) {
      loadPricesForInventoryProducts();
    }
  }, [productsMap, loadPricesForInventoryProducts]);


  const loadProductExtendedData = (products) => {
    const extendedDataMap = {};
    
    products.forEach(product => {
      const productId = String(product.product_id || product.id);
      const extendedData = extractExtendedDataFromProduct(product);
      if (Array.isArray(extendedData) && extendedData.length > 0) {
        extendedDataMap[productId] = extendedData;
      }
    });
    
    setProductExtendedData(prev => ({ ...prev, ...extendedDataMap }));
  };

  const handleAttributeFilter = (key, value) => {
    // Update pending filters instead of applying immediately
    setPendingAttributeFilters(prev => {
      const newFilters = { ...prev };
      const currentValue = newFilters[key];
      const currentValues = Array.isArray(currentValue) 
        ? currentValue 
        : (currentValue ? [currentValue] : []);
      
      if (currentValues.includes(value)) {
        const updatedValues = currentValues.filter(v => v !== value);
        if (updatedValues.length === 0) {
          delete newFilters[key];
        } else {
          newFilters[key] = updatedValues;
        }
      } else {
        newFilters[key] = [...currentValues, value];
      }
      
      return newFilters;
    });
  };

  const handleApplyAttributeFilters = () => {
    setAttributeFilters(pendingAttributeFilters);
    setShowAttributeFilters(false);
  };

  const handleClearPendingFilters = () => {
    setPendingAttributeFilters({});
    // Clear applied filters and refresh products
    setAttributeFilters({});
    setCurrentPage(1);
    loadProducts(1, false);
  };

  const toggleAttributeGroup = (key) => {
    setCollapsedAttributeGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleGroupFilter = (groupId) => {
    setSelectedGroupId(groupId);
  };

  // Removed unused handlers - ProductListingContent uses inline handlers

  const handleFavoriteToggle = async (e, productId) => {
    e.stopPropagation();
    if (!user) return;

    const productIdStr = String(productId);
    const isFavorited = favorites.has(productIdStr);

    try {
      await toggleFavorite(user.id, productId, isFavorited);
      if (isFavorited) {
        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(productIdStr);
          return newSet;
        });
    } else {
        setFavorites(prev => new Set(prev).add(productIdStr));
      }
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

  const handleInventoryChange = (productId, delta) => {
    if (!user) return;
    
    const productIdStr = String(productId);
    setStagedInventory(prev => {
      const currentQuantity = prev[productIdStr] !== undefined 
        ? prev[productIdStr] 
        : (inventory[productIdStr] || 0);
      const newQuantity = Math.max(0, currentQuantity + delta);
      
      if (newQuantity === (inventory[productIdStr] || 0)) {
        // If new quantity matches original, remove from staged
        const newStaged = { ...prev };
        delete newStaged[productIdStr];
        return newStaged;
      }
      
      return {
        ...prev,
        [productIdStr]: newQuantity
      };
    });
  };

  // Calculate delta for inventory changes
  const calculateInventoryDelta = () => {
    return calculateDeltaUtil(inventory, stagedInventory);
  };

  // Actual apply logic (called after confirmation)
  const applyInventoryChanges = async () => {
    if (!user) return;

    try {
      setIsUpdatingInventory(true);
      
      const { mergedItems } = calculateInventoryDelta();
      
      // Convert merged items to the format expected by bulkUpdateInventory
      const itemsToUpdate = {};
      Object.entries(mergedItems).forEach(([productId, quantity]) => {
        if (quantity > 0) {
          itemsToUpdate[productId] = quantity;
        }
      });
      
      await bulkUpdateInventory(user.id, itemsToUpdate);
      
      // Update local inventory state
      setInventory(mergedItems);
        setStagedInventory({});
      setShowDeltaConfirmation(false);
      
      setNotification({
        isOpen: true,
        title: 'Success',
        message: 'Inventory updated successfully!',
        type: 'success'
      });
    } catch (err) {
      console.error('Error updating inventory:', err);
      setNotification({
        isOpen: true,
        title: 'Error',
        message: 'Failed to update inventory. Please try again.',
        type: 'error'
      });
    } finally {
        setIsUpdatingInventory(false);
    }
  };

  // Show delta confirmation before applying
  const handleApplyInventory = () => {
    if (!user || Object.keys(stagedInventory).length === 0) return;
    
    // Calculate delta and show confirmation
    const { addedItems, updatedItems, removedItems } = calculateInventoryDelta();
    const hasChanges = Object.keys(addedItems).length > 0 || 
                      Object.keys(updatedItems).length > 0 || 
                      removedItems.length > 0;
    
    if (!hasChanges) {
      setNotification({
        isOpen: true,
        title: 'No Changes',
        message: 'No changes to apply.',
        type: 'info'
      });
      return;
    }
    
    setShowDeltaConfirmation(true);
  };

  const handleDiscardInventoryChanges = () => {
      setStagedInventory({});
    setShowDeltaConfirmation(false);
  };

  const handleDiscardInventory = () => {
    setConfirmation({
      isOpen: true,
      title: 'Discard Changes',
      message: 'Are you sure you want to discard all inventory changes?',
      onConfirm: () => {
        setStagedInventory({});
        setConfirmation({ isOpen: false, title: '', message: '', onConfirm: null });
      }
    });
  };

  const handleImportInventory = async (importText) => {
    if (!user) {
      setNotification({
        isOpen: true,
        title: 'Import Failed',
        message: 'You must be logged in to import inventory.',
        type: 'error'
      });
      return;
    }

    if (isImporting) return;
    setIsImporting(true);

    try {
      // Parse import text
      const { parsed, errors, cardNumbersToFind } = parseImportText(importText);
      
      if (errors.length > 0) {
        setIsImporting(false);
        setNotification({
          isOpen: true,
          title: 'Import Failed',
          message: `Errors found:\n\n${errors.join('\n')}`,
          type: 'error'
        });
        return;
      }

      // Fetch products by card numbers
      const { cardNumberToProducts } = await fetchProductsByCardNumbers(
        categoryId,
        cardNumbersToFind,
        mergeProductsIntoMap
      );

      // Match products to import lines
      const { importedItems, errors: matchErrors, warnings } = matchProductsToImportLines(
        parsed,
        cardNumberToProducts
      );

      if (matchErrors.length > 0) {
        setIsImporting(false);
        setNotification({
          isOpen: true,
          title: 'Import Failed',
          message: `Errors found:\n\n${matchErrors.join('\n')}${warnings.length > 0 ? '\n\nWarnings:\n' + warnings.join('\n') : ''}`,
          type: 'error'
        });
        return;
      }

      // Apply import (additive for inventory)
      const newStagedItems = applyImportAdditive(inventory, stagedInventory, importedItems);

      console.log('[Import Debug] Current merged inventory:', getMergedItems(inventory, stagedInventory));
      console.log('[Import Debug] Imported items (quantities to add):', importedItems);
      console.log('[Import Debug] New staged items (after adding):', newStagedItems);

      // Apply staged changes (merged with existing)
      setStagedInventory(newStagedItems);

      const addedCount = Object.values(importedItems).reduce((sum, qty) => sum + qty, 0);
      let message = `Import successful! ${Object.keys(importedItems).length} card type(s) imported, ${addedCount} total card(s) added to inventory (staged).`;
      if (warnings.length > 0) {
        message += `\n\nWarnings:\n${warnings.join('\n')}`;
      }

      setIsImporting(false);
      setNotification({
        isOpen: true,
        title: 'Import Successful',
        message: message,
        type: 'success'
      });
    } catch (err) {
      console.error('Error during import:', err);
      setIsImporting(false);
      setNotification({
        isOpen: true,
        title: 'Import Failed',
        message: 'Error importing inventory. Please try again.',
        type: 'error'
      });
    }
  };

  const handleRemoveInventory = async (removeText) => {
    if (!user) {
      setNotification({
        isOpen: true,
        title: 'Remove Failed',
        message: 'You must be logged in to remove from inventory.',
        type: 'error'
      });
      return;
    }

    if (isRemoving) return;

    setIsRemoving(true);

    try {
      // Parse remove text (same format as import)
      const { parsed, errors, cardNumbersToFind } = parseImportText(removeText);
      
      if (errors.length > 0) {
        setIsRemoving(false);
        setNotification({
          isOpen: true,
          title: 'Remove Failed',
          message: `Errors found:\n\n${errors.join('\n')}`,
          type: 'error'
        });
        return;
      }

      // Fetch products by card numbers
      const { cardNumberToProducts } = await fetchProductsByCardNumbers(
        categoryId,
        cardNumbersToFind,
        mergeProductsIntoMap
      );

      // Match products to remove lines and calculate quantities after removal
      const removedItems = {}; // { productId: quantityAfterRemoval }
      const warnings = [];

      parsed.forEach(({ quantity, cardNumber, cardName, lineIndex }) => {
        const productsWithPrices = cardNumberToProducts[cardNumber];
        if (!productsWithPrices || productsWithPrices.length === 0) {
          warnings.push(`Line ${lineIndex}: Card number "${cardNumber}" not found in category`);
          return;
        }

        // Select product (same logic as import)
        let selectedProduct = productsWithPrices[0];
        if (productsWithPrices.length > 1) {
          if (cardName) {
            const nameMatch = productsWithPrices.find(p => 
              p.product.name && p.product.name.toLowerCase() === cardName.toLowerCase()
            );
            if (nameMatch) {
              selectedProduct = nameMatch;
            } else {
              warnings.push(`Line ${lineIndex}: Multiple products found for card number "${cardNumber}", using lowest price (name "${cardName}" didn't match)`);
            }
          } else {
            warnings.push(`Line ${lineIndex}: Multiple products found for card number "${cardNumber}", using lowest price`);
          }
        }

        const productId = selectedProduct.productId;
        if (quantity > 0) {
          const productIdStr = String(productId);
          const currentQuantity = stagedInventory[productIdStr] !== undefined 
            ? stagedInventory[productIdStr] 
            : (inventory[productIdStr] || 0);
          removedItems[productIdStr] = Math.max(0, currentQuantity - quantity); // Subtractive remove (clamped at 0)
        }
      });

      console.log('[Remove Debug] Removed Items:', removedItems);

      // Apply removal (subtractive)
      const newStagedItems = applyRemoval(inventory, stagedInventory, removedItems);

      console.log('[Remove Debug] Current merged inventory:', getMergedItems(inventory, stagedInventory));
      console.log('[Remove Debug] Removed items (quantities after removal):', removedItems);
      console.log('[Remove Debug] New staged items (after removal):', newStagedItems);

      // Apply staged changes (merged with existing)
      setStagedInventory(newStagedItems);

      const currentMerged = getMergedItems(inventory, stagedInventory);
      const removedCount = Object.entries(removedItems).reduce((sum, [productId, newQty]) => {
        const productIdStr = String(productId);
        const currentQuantity = currentMerged[productIdStr] || 0;
        return sum + Math.max(0, currentQuantity - newQty);
      }, 0);
    
    let message = `Remove successful! ${removedCount} total card(s) removed.`;
    if (warnings.length > 0) {
      message += `\n\nWarnings:\n${warnings.join('\n')}`;
    }

      setIsRemoving(false);
      setNotification({
        isOpen: true,
        title: 'Remove Successful',
        message: message,
        type: 'success'
      });
    } catch (err) {
      console.error('Error during remove:', err);
      setIsRemoving(false);
      setNotification({
        isOpen: true,
        title: 'Remove Failed',
        message: 'Error removing from inventory. Please try again.',
        type: 'error'
      });
    }
  };

  const convertCurrency = (usdValue) => {
    if (selectedCurrency === 'usd' || !currencyRates) {
      return usdValue;
    }
    const rate = currencyRates[selectedCurrency];
    if (!rate) {
      return usdValue;
    }
    return usdValue * rate;
  };

  const formatCurrency = (value) => {
    const convertedValue = convertCurrency(value);
    const symbols = {
      usd: '$',
      cad: 'C$',
      eur: '€'
    };
    const symbol = symbols[selectedCurrency] || '$';
    return `${symbol}${convertedValue.toFixed(2)}`;
  };

  const getRarity = (product) => {
    const extendedData = extractExtendedDataFromProduct(product);
    const rarityItem = extendedData.find(item => {
      const key = (item.key || item.name || '').toUpperCase();
      return key === 'RARITY';
    });
    if (!rarityItem) return null;
    
    let rarity = (rarityItem.value || rarityItem.val || '').trim().toUpperCase();
    if (rarity === 'LEGEND RARE' || rarity === 'LEGENDRARE') {
      rarity = 'LR';
    }
    return rarity;
  };

  // Get color value from string (handles hex, rgb, color names)
  const getColorValue = (colorString) => {
    if (!colorString) return null;
    
    // Color name mapping
    const colorMap = {
      'red': '#ef4444',
      'blue': '#3b82f6',
      'green': '#10b981',
      'yellow': '#fbbf24',
      'purple': '#a855f7',
      'orange': '#f97316',
      'pink': '#ec4899',
      'black': '#1f2937',
      'white': '#ffffff',
      'gray': '#6b7280',
      'grey': '#6b7280'
    };
    
    const lowerColor = colorString.toLowerCase().trim();
    if (colorMap[lowerColor]) {
      return colorMap[lowerColor];
    }
    
    // If it's already a hex or rgb, return as is
    if (colorString.startsWith('#') || colorString.startsWith('rgb')) {
      return colorString;
    }
    
    return null;
  };

  // Determine if a color is light or dark for text contrast
  const getColorBrightness = (colorValue) => {
    if (!colorValue) return 'dark';
    
    let r = 0, g = 0, b = 0;
    
    // Normalize color value
    const normalizedColor = getColorValue(colorValue) || colorValue;
    
    if (normalizedColor.startsWith('#')) {
      const hex = normalizedColor.slice(1);
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
      const rgbMatch = normalizedColor.match(/\d+/g);
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
    // This ensures only white/very light colors use gray text, not bright saturated colors
    return (r > 240 && g > 240 && b > 240) ? 'light' : 'dark';
  };

  const getProductAttributes = (productId, product = null) => {
    let extendedData = [];
    
    // Try to get from product object's extended_data_raw first (it's a JSON string that needs parsing)
    if (product) {
      // extended_data_raw is a raw JSON string that needs to be parsed
      if (product.extended_data_raw) {
        try {
          const parsed = typeof product.extended_data_raw === 'string' 
            ? JSON.parse(product.extended_data_raw)
            : product.extended_data_raw;
          
          if (Array.isArray(parsed)) {
            extendedData = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            // Convert object to array format
            extendedData = Object.entries(parsed).map(([key, value]) => ({
              key,
              value,
              name: key,
              val: value
            }));
          }
        } catch (err) {
          // Silently handle parse errors, fall back to other sources
        }
      }
      
      // Fallback to other field names if extended_data_raw not available
      if (extendedData.length === 0) {
        const rawData = product.extended_data || product.extendedData || product.attributes;
        
        if (rawData) {
          if (Array.isArray(rawData)) {
            extendedData = rawData;
          } else if (typeof rawData === 'object') {
            // Convert object to array format
            extendedData = Object.entries(rawData).map(([key, value]) => ({
              key,
              value,
              name: key,
              val: value
            }));
          }
        }
      }
    }
    
    // Fall back to productExtendedData state if not found in product
    if (extendedData.length === 0) {
      extendedData = productExtendedData[String(productId)] || [];
    }
    
    const attributes = {
      cardType: null,
      color: null,
      level: null,
      cost: null,
      attackPoints: null,
      hitPoints: null
    };
    
    extendedData.forEach(item => {
      const key = (item.key || item.name || '').toUpperCase();
      const value = item.value || item.val;
      
      if (key === 'CARDTYPE' && value) {
        attributes.cardType = value;
      } else if (key === 'COLOR' && value) {
        attributes.color = getColorValue(value);
      } else if (key === 'LEVEL' && value) {
        attributes.level = value;
      } else if (key === 'COST' && value) {
        // Try to parse as integer
        const costNum = parseInt(value, 10);
        if (!isNaN(costNum)) {
          attributes.cost = costNum;
        }
      } else if (key === 'ATTACK POINTS' || key === 'ATTACKPOINTS' || key === 'ATTACK') {
        attributes.attackPoints = value;
      } else if (key === 'HIT POINTS' || key === 'HITPOINTS' || key === 'HP') {
        attributes.hitPoints = value;
      }
    });
    
    return attributes;
  };

  // Calculate inventory statistics for sidebar
  const getInventoryStats = () => {
    const allProductsArray = Object.values(productsMap);
    const inventoryProducts = allProductsArray.filter(product => {
        const productId = String(product.product_id || product.id);
        const quantity = stagedInventory[productId] !== undefined 
          ? stagedInventory[productId] 
          : (inventory[productId] || 0);
      return quantity > 0;
    });

    const totalCards = inventoryProducts.reduce((sum, product) => {
      const productId = String(product.product_id || product.id);
      const quantity = stagedInventory[productId] !== undefined 
        ? stagedInventory[productId] 
        : (inventory[productId] || 0);
      return sum + quantity;
    }, 0);

    let totalValue = 0;
    inventoryProducts.forEach(product => {
      const productId = String(product.product_id || product.id);
      const quantity = stagedInventory[productId] !== undefined 
        ? stagedInventory[productId] 
        : (inventory[productId] || 0);
      
      if (quantity > 0) {
        const price = inventoryProductPrices[parseInt(productId, 10)];
        const marketPrice = price?.market_price || price?.marketPrice;
        if (marketPrice !== null && marketPrice !== undefined) {
          const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
          if (!isNaN(priceNum)) {
            totalValue += priceNum * quantity;
          }
        }
      }
    });

    return { totalCards, totalValue };
  };

  // Calculate histogram data
  const getHistogramData = () => {
    const allProductsArray = Object.values(productsMap);
    const inventoryProducts = allProductsArray.filter(product => {
      const productId = String(product.product_id || product.id);
      const quantity = stagedInventory[productId] !== undefined 
        ? stagedInventory[productId] 
        : (inventory[productId] || 0);
      return quantity > 0;
    });

    if (histogramTab === 'cardType') {
      const cardTypeFrequency = {};
      const cardTypes = new Set(['Base', 'Command', 'Pilot', 'Unit']);
      
      inventoryProducts.forEach(product => {
        const productId = String(product.product_id || product.id);
        const quantity = stagedInventory[productId] !== undefined 
          ? stagedInventory[productId] 
          : (inventory[productId] || 0);
        
        if (quantity > 0) {
          const attrs = getProductAttributes(productId);
          const cardType = attrs.cardType;
          if (cardType && cardTypes.has(cardType)) {
            cardTypeFrequency[cardType] = (cardTypeFrequency[cardType] || 0) + quantity;
          }
        }
      });

      return {
        type: 'cardType',
        data: cardTypeFrequency,
        allValues: ['Base', 'Command', 'Pilot', 'Unit'],
        getLabel: (value) => value,
        getTitle: (value, freq, pct) => `${value}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
      };
    } else if (histogramTab === 'market') {
      const valuePercentages = [100, 95, 90, 85, 80, 75, 70];
      const stats = getInventoryStats();
      const totalValue = stats.totalValue;
      
      const valueData = valuePercentages
        .filter(percentage => percentage <= maxPercentage)
        .map(percentage => ({
          percentage,
          value: totalValue * (percentage / 100)
        }));

      return {
        type: 'market',
        data: valueData,
        allValues: valuePercentages,
        getLabel: (value) => `${value}%`,
        getTitle: (value, freq, pct) => `${value}%: ${formatCurrency(totalValue * (value / 100))}`
      };
    }

    return null;
  };

  const hasStagedChanges = Object.keys(stagedInventory).length > 0;
  const stats = getInventoryStats();

  if (loading && products.length === 0) {
    return (
      <div className="products-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading products...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="products-page">
      <NavigationBar className="products-header" />

      <main className="products-main">
          <button 
            className="mobile-sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Open inventory sidebar' : 'Close inventory sidebar'}
          >
            <span className="mobile-toggle-icon">📦</span>
          {hasStagedChanges && (
            <span className="mobile-toggle-badge delta-positive">
              {Object.keys(stagedInventory).length}
                </span>
        )}
        </button>

        {!sidebarCollapsed && (
          <div 
            className={`mobile-sidebar-overlay ${!sidebarCollapsed ? 'active' : ''}`}
            onClick={() => setSidebarCollapsed(true)}
          />
        )}

        <div className="deck-builder-layout">
          {/* Inventory Sidebar */}
            <aside className={`deck-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${!sidebarCollapsed ? 'mobile-expanded' : ''}`}>
              {!sidebarCollapsed && (
                <button 
                  className="mobile-sidebar-close"
                  onClick={() => setSidebarCollapsed(true)}
                  aria-label="Close sidebar"
                >
                  ✕
                </button>
              )}
            
              <div className="sidebar-header">
              <h3>Inventory</h3>
              {user && (
                <button
                  className="sidebar-export-button"
                  onClick={() => setShowExportModal(true)}
                  title="Import/Export inventory"
                >
                  📤
                </button>
              )}
              </div>
              
              {!sidebarCollapsed && (
                <>
                  <div className="sidebar-content">
                    {(() => {
                      const allProductsArray = Object.values(productsMap);
                      const inventoryItems = buildSidebarItems(
                        allProductsArray,
                        inventory,
                        stagedInventory,
                        null,
                        'name'
                      );
                            
                            return (
                        <SidebarCardList
                          items={inventoryItems}
                          getProductAttributes={getProductAttributes}
                          getColorBrightness={getColorBrightness}
                          productPrices={inventoryProductPrices}
                          formatCurrency={formatCurrency}
                          maxPercentage={maxPercentage}
                          onAddClick={user ? (e, productId) => {
                            e.stopPropagation();
                            handleInventoryChange(productId, 1);
                          } : null}
                          onRemoveClick={user ? (e, productId) => {
                            e.stopPropagation();
                            handleInventoryChange(productId, -1);
                          } : null}
                          canEdit={!!user}
                          emptyMessage="No items in inventory yet"
                        />
                                    );
                                  })()}
                                </div>
                                
                {/* Distribution Histograms */}
                {(() => {
                  // Calculate frequencies for card type
                  const cardTypeFrequency = {};
                  const allProductsArray = Object.values(productsMap);
                  const inventoryProducts = allProductsArray.filter(product => {
                    const productId = String(product.product_id || product.id);
                    const quantity = stagedInventory[productId] !== undefined 
                      ? stagedInventory[productId] 
                      : (inventory[productId] || 0);
                    return quantity > 0;
                  });

                  inventoryProducts.forEach(product => {
                    const productId = String(product.product_id || product.id);
                    const quantity = stagedInventory[productId] !== undefined 
                      ? stagedInventory[productId] 
                      : (inventory[productId] || 0);
                    
                    if (quantity > 0) {
                      const attrs = getProductAttributes(productId, product);
                      const cardType = attrs.cardType;
                      if (cardType && ['Base', 'Command', 'Pilot', 'Unit'].includes(cardType)) {
                        cardTypeFrequency[cardType] = (cardTypeFrequency[cardType] || 0) + quantity;
                      }
                    }
                  });

                  // Calculate total value
                  let totalValue = 0;
                  inventoryProducts.forEach(product => {
                    const productId = String(product.product_id || product.id);
                    const quantity = stagedInventory[productId] !== undefined 
                      ? stagedInventory[productId] 
                      : (inventory[productId] || 0);
                    
                    if (quantity > 0) {
                      const price = inventoryProductPrices[parseInt(productId, 10)];
                      const marketPrice = price?.market_price || price?.marketPrice;
                      if (marketPrice !== null && marketPrice !== undefined) {
                        const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
                        if (!isNaN(priceNum)) {
                          totalValue += priceNum * quantity;
                        }
                      }
                    }
                  });

                  const totalCards = stats.totalCards;

                  // Calculate values at different percentage thresholds
                  const valuePercentages = [100, 95, 90, 85, 80, 75, 70];
                  const valueData = valuePercentages
                    .filter(percentage => percentage <= maxPercentage)
                    .map(percentage => ({
                      percentage,
                      value: totalValue * (percentage / 100)
                    }));

                  const sortedCardTypes = ['Base', 'Command', 'Pilot', 'Unit'];

                                    return (
                    <DistributionHistograms
                      histogramTab={histogramTab}
                      setHistogramTab={setHistogramTab}
                      histogramsMinimized={histogramsMinimized}
                      setHistogramsMinimized={setHistogramsMinimized}
                      histogramsExpanded={undefined}
                      setHistogramsExpanded={undefined}
                      costFrequency={{}}
                      levelFrequency={{}}
                      cardTypeFrequency={cardTypeFrequency}
                      valueData={valueData}
                      allCosts={[]}
                      allLevels={[]}
                      sortedCardTypes={sortedCardTypes}
                      totalCards={totalCards}
                      totalValue={totalValue}
                      maxPercentage={maxPercentage}
                      setMaxPercentage={setMaxPercentage}
                      selectedCurrency={selectedCurrency}
                      setSelectedCurrency={setSelectedCurrency}
                      loadingRates={loadingRates}
                      currencyRates={currencyRates}
                      formatCurrency={formatCurrency}
                      categoryRules={null}
                      availableTabs={['cardType', 'market']}
                    />
                                    );
                                  })()}

                {/* Action buttons */}
                {user && hasStagedChanges && (
                  <div className="sidebar-actions">
                    {!isUpdatingInventory && (
                    <button
                      className="discard-button"
                        onClick={handleDiscardInventory}
                    >
                      Discard
                    </button>
                    )}
                    {!isUpdatingInventory && (
                    <button
                      className="apply-button"
                        onClick={handleApplyInventory}
                    >
                        Apply
                    </button>
                    )}
                  </div>
                )}
                </>
              )}
            </aside>

          {/* Main Content */}
          <div className="deck-builder-content">
            {/* Card List Header */}
            <PageHeader
              title="Card List"
              actions={
                user && (
                  <>
                    <button 
                      className="import-export-button-header" 
                      onClick={() => setShowExportModal(true)}
                      title="Import/Export inventory"
                    >
                      📤 Import/Export
                    </button>
                    <span className="inventory-manager-badge">Inventory Manager</span>
                  </>
                )
              }
              maxPercentage={maxPercentage}
              setMaxPercentage={setMaxPercentage}
              className="card-list-header"
            />
            <ProductListingContent
              // State props
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              sortOption={sortOption}
              setSortOption={setSortOption}
              showFavoritesOnly={showFavoritesOnly}
              setShowFavoritesOnly={setShowFavoritesOnly}
              showOwnedOnly={showOwnedOnly}
              setShowOwnedOnly={setShowOwnedOnly}
              showInDeckOnly={undefined}
              setShowInDeckOnly={undefined}
              selectedGroupId={selectedGroupId}
              setSelectedGroupId={setSelectedGroupId}
              attributeFilters={attributeFilters}
              pendingAttributeFilters={pendingAttributeFilters}
              setPendingAttributeFilters={setPendingAttributeFilters}
              attributeValues={attributeValues}
              categoryKeys={categoryKeys}
              showAttributeFilters={showAttributeFilters}
              setShowAttributeFilters={setShowAttributeFilters}
              collapsedAttributeGroups={collapsedAttributeGroups}
              setCollapsedAttributeGroups={setCollapsedAttributeGroups}
              
              // Data props
              products={products}
              filteredProducts={filteredProducts}
              groups={groups}
              loading={loading}
              loadingGroups={loadingGroups}
              loadingAttributes={loadingAttributes}
              loadingMore={loadingMore}
              error={error}
              currentPage={currentPage}
              totalCount={totalCount}
              hasMorePages={hasMorePages}
              onLoadMore={loadMoreProducts}
              newlyAddedProductIds={newlyAddedProductIds}
              
              // User and permissions
              user={user}
              canEdit={false}
              
              // Product rendering props
              getQuantity={(productIdStr) => {
                return stagedInventory[productIdStr] !== undefined 
                  ? stagedInventory[productIdStr] 
                  : (inventory[productIdStr] || 0);
              }}
              getRarity={getRarity}
              formatCurrency={formatCurrency}
              productPrices={productPrices}
              maxPercentage={maxPercentage}
              favorites={favorites}
              
              // Event handlers
              onProductClick={(productId) => {
                setPreviewProductId(productId);
                setIsPreviewOpen(true);
              }}
              onFavoriteToggle={handleFavoriteToggle}
              onAddToDeck={user ? (e, productId) => {
                e.stopPropagation();
                handleInventoryChange(productId, 1);
              } : undefined}
              onRemoveFromDeck={user ? (e, productId) => {
                e.stopPropagation();
                handleInventoryChange(productId, -1);
              } : undefined}
              handleGroupFilter={handleGroupFilter}
              handleAttributeFilter={handleAttributeFilter}
              handleApplyAttributeFilters={handleApplyAttributeFilters}
              handleClearPendingFilters={handleClearPendingFilters}
              toggleAttributeGroup={toggleAttributeGroup}
              
              // Custom render props
              renderProductCardActions={(product, productId, productIdStr, quantity) => {
                if (!user) return null;
                return (
                  <div className="deck-controls">
                    <div className="deck-buttons">
                <button
                        className="deck-add-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInventoryChange(productId, 1);
                        }}
                        title="Add to inventory"
                      >
                        +
                </button>
                      {quantity > 0 && (
                <button
                          className="deck-remove-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInventoryChange(productId, -1);
                          }}
                          title="Remove from inventory"
                        >
                          −
                </button>
                      )}
                    </div>
              </div>
                );
              }}
              renderFavoriteButton={(product, productId, productIdStr, isFavorited) => {
                if (!user) return null;
                return (
                  <button
                    className={`favorite-button-card ${isFavorited ? 'favorited' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFavoriteToggle(e, productId);
                    }}
                    title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {isFavorited ? '★' : '☆'}
                  </button>
                );
              }}
              productCardClassName={(product, quantity) => {
                return quantity > 0 ? 'in-deck-card' : '';
              }}
            />
            </div>
          </div>
      </main>

      <ProductPreviewModal
        productId={previewProductId}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewProductId(null);
        }}
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

      <ExportDeckModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        deckName="Inventory"
        deckItems={(() => {
          const items = {};
          const allProductsArray = Object.values(productsMap);
          allProductsArray.forEach(product => {
            const productId = String(product.product_id || product.id);
            const quantity = stagedInventory[productId] !== undefined 
              ? stagedInventory[productId] 
              : (inventory[productId] || 0);
            if (quantity > 0) {
              items[productId] = quantity;
            }
          });
          return items;
        })()}
        deckProducts={(() => {
          const allProductsArray = Object.values(productsMap);
          return allProductsArray.filter(product => {
            const productId = String(product.product_id || product.id);
            const quantity = stagedInventory[productId] !== undefined 
              ? stagedInventory[productId] 
              : (inventory[productId] || 0);
            return quantity > 0;
          });
        })()}
        onImport={handleImportInventory}
        onRemove={handleRemoveInventory}
        canEdit={!!user}
        isImporting={isImporting || isRemoving}
        showPrepopulate={false}
        showMSAButton={false}
        showCopyButton={false}
      />

      {/* Delta Confirmation Modal */}
      {(() => {
        const { addedItems, updatedItems, removedItems } = calculateInventoryDelta();
        // Use the products map directly (already keyed by product_id)
        return (
          <DeckDeltaConfirmation
            isOpen={showDeltaConfirmation}
            onClose={() => setShowDeltaConfirmation(false)}
            onConfirm={applyInventoryChanges}
            onDiscard={handleDiscardInventoryChanges}
            addedItems={addedItems}
            updatedItems={updatedItems}
            removedItems={removedItems}
            products={productsMap}
          />
        );
      })()}
    </div>
  );
};

export default ProductsPage;

