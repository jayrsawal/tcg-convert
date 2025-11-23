import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { getFavorites, toggleFavorite } from '../lib/favorites';
import { getUserInventory } from '../lib/inventory';
import { fetchDeckList, updateDeckListName, updateDeckListItems, deleteDeckListItems, fetchCategoryRules } from '../lib/api';
import { fetchGroupsByCategory, fetchProductExtendedDataKeyValues, filterProducts, searchProducts, fetchProductsBulk, extractExtendedDataFromProduct, fetchCurrentPricesBulk } from '../lib/api';
import { parseImportText, fetchProductsByCardNumbers, matchProductsToImportLines } from '../lib/importUtils';
import { calculateDelta as calculateDeltaUtil } from '../lib/deltaUtils';
import { applyImportExact, getMergedItems } from '../lib/stagingUtils';
import { buildSidebarItems } from '../lib/sidebarUtils';
import NavigationBar from './NavigationBar';
import ProductPreviewModal from './ProductPreviewModal';
import NotificationModal from './NotificationModal';
import ConfirmationModal from './ConfirmationModal';
import ExportDeckModal from './ExportDeckModal';
import PageHeader from './PageHeader';
import ProductListingContent from './ProductListingContent';
import DeckDeltaConfirmation from './DeckDeltaConfirmation';
import SidebarCardList from './SidebarCardList';
import DistributionHistograms from './DistributionHistograms';
import './DeckBuilderPage.css';

const DeckBuilderPage = () => {
  const { deckListId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedCurrency, setSelectedCurrency, currencyRates, loadingRates } = useCurrency();
  const [deckList, setDeckList] = useState(null);
  const [deckItems, setDeckItems] = useState({}); // { product_id: quantity } - current deck items from server
  const [stagedDeckItems, setStagedDeckItems] = useState({}); // { product_id: quantity } - staged changes
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
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
  const [showInDeckOnly, setShowInDeckOnly] = useState(false);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [inventory, setInventory] = useState({}); // { product_id: quantity } map
  const [isUpdatingDeck, setIsUpdatingDeck] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(true); // Start as true to trigger initial load
  const [newlyAddedProductIds, setNewlyAddedProductIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingAttributes, setLoadingAttributes] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [editingDeckName, setEditingDeckName] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [categoryRules, setCategoryRules] = useState(null);
  const [deckProducts, setDeckProducts] = useState([]); // Products in the deck for sidebar display
  const [productExtendedData, setProductExtendedData] = useState({}); // { productId: [{key, value}] }
  const [productPrices, setProductPrices] = useState({}); // { productId: { market_price, ... } }
  const [validationErrors, setValidationErrors] = useState([]);
  const [previewProductId, setPreviewProductId] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [notification, setNotification] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeltaConfirmation, setShowDeltaConfirmation] = useState(false);
  const [histogramTab, setHistogramTab] = useState('cost'); // 'cost', 'level', 'cardType', 'value'
  const [histogramsMinimized, setHistogramsMinimized] = useState(false);
  const [histogramsExpanded, setHistogramsExpanded] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [maxPercentage, setMaxPercentage] = useState(100);
  const pendingNavigationRef = useRef(null);
  
  // History for undo functionality
  const [history, setHistory] = useState([]);
  const historyIndexRef = useRef(-1);
  
  // Guards to prevent duplicate API calls
  const loadingDeckListRef = useRef(false);
  const loadingProductsRef = useRef(false);
  const loadingGroupsRef = useRef(false);
  const loadingAttributesRef = useRef(false);
  const loadingCategoryRulesRef = useRef(false);
  const loadingDeckProductsRef = useRef(false);
  const lastDeckListIdRef = useRef(null);
  const lastCategoryIdRef = useRef(null);
  const lastFilterParamsRef = useRef(null);
  const lastProductIdsRef = useRef('');
  const prevFilterStateRef = useRef({
    searchQuery: '',
    showFavoritesOnly: false,
    showInDeckOnly: false,
    showOwnedOnly: false,
    shouldFilterToDeck: false,
    productsLength: 0,
    deckProductsLength: 0
  });
  const isUpdatingDeckProductsRef = useRef(false);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    // Load deck list regardless of authentication status (for public viewing)
    // Only load if deckListId changed or we haven't loaded yet
    if (deckListId !== lastDeckListIdRef.current && !loadingDeckListRef.current) {
      loadDeckList();
    }
  }, [deckListId]);

  useEffect(() => {
    if (!deckList || !deckList.category_id) return;
    
    const categoryId = deckList.category_id;
    
    // Only load category-specific data if category changed
    if (categoryId !== lastCategoryIdRef.current) {
      lastCategoryIdRef.current = categoryId;
      
      // Reset filter params when category changes
      lastFilterParamsRef.current = null;
      
      // Load these only once per category
      if (!loadingGroupsRef.current) {
        loadGroups();
      }
      if (!loadingAttributesRef.current) {
        loadAttributes();
      }
      if (!loadingCategoryRulesRef.current) {
        loadCategoryRules();
      }
      if (user) {
        loadFavorites();
        loadInventory();
      }
      
      // Load products with current filters (initial load)
      if (!loadingProductsRef.current) {
        // Set initial filter params to prevent duplicate load
        const initialFilterParams = JSON.stringify({
          group_id: selectedGroupId,
          filters: attributeFilters,
          sortOption: sortOption
        });
        lastFilterParamsRef.current = initialFilterParams;
        setCurrentPage(1);
        loadProducts(1, false);
      }
    }
  }, [deckList?.category_id]); // Only depend on category_id, not entire deckList object

  useEffect(() => {
    if (!deckList || !deckList.category_id) return;
    
    // Skip initial load (handled by category change effect)
    if (lastCategoryIdRef.current !== deckList.category_id) return;
    
    // Only reload products when filters actually change
    const currentFilterParams = JSON.stringify({
      group_id: selectedGroupId,
      filters: attributeFilters,
      sortOption: sortOption
    });
    
    if (currentFilterParams !== lastFilterParamsRef.current && !loadingProductsRef.current) {
      lastFilterParamsRef.current = currentFilterParams;
      setCurrentPage(1);
      loadProducts(1, false);
    }
  }, [selectedGroupId, attributeFilters, sortOption, deckList?.category_id]);

  useEffect(() => {
    // Load deck products whenever deck items change (including staged changes)
    // But debounce to avoid excessive API calls when rapidly adding/removing cards
    if (loadingDeckProductsRef.current) return;
    
    const mergedItems = { ...deckItems, ...stagedDeckItems };
    const productIds = Object.keys(mergedItems)
      .filter(id => mergedItems[id] > 0)
      .map(id => parseInt(id))
      .filter(id => !isNaN(id))
      .sort((a, b) => a - b); // Sort for consistent comparison
    
    const productIdsKey = productIds.join(',');
    
    // Only reload if product IDs actually changed
    if (productIdsKey !== lastProductIdsRef.current) {
      lastProductIdsRef.current = productIdsKey;
      isUpdatingDeckProductsRef.current = true;
      
      // Debounce the API call slightly to batch rapid changes
      const timeoutId = setTimeout(async () => {
        if (productIds.length > 0) {
          await loadDeckProductsForIds(productIds);
        } else {
          setDeckProducts([]);
        }
        // Mark update as complete after a brief delay to allow state to settle
        setTimeout(() => {
          isUpdatingDeckProductsRef.current = false;
        }, 50);
      }, 100); // Small delay to batch rapid changes
      
      return () => {
        clearTimeout(timeoutId);
        isUpdatingDeckProductsRef.current = false;
      };
    }
  }, [deckItems, stagedDeckItems]);

  // Client-side filtering
  useEffect(() => {
    // Preserve scroll position before filtering
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollElement = document.documentElement || document.body;
    const scrollTop = scrollElement.scrollTop || scrollY;
    
    // Store scroll position in ref for reliable restoration
    if (scrollY > 0 || scrollTop > 0) {
      scrollPositionRef.current = scrollY || scrollTop;
    }
    
    // In view-only mode, always filter to show only cards in deck
    // In edit mode, apply "in deck" filter if enabled
    const isOwner = user && deckList && deckList.user_id === user.id;
    const shouldFilterToDeck = !isOwner || showInDeckOnly;
    
    // When filtering to deck cards, use deckProducts (loaded by ID) as the source
    // Otherwise, use products (from server-side filtering)
    let sourceProducts = shouldFilterToDeck ? [...deckProducts] : [...products];
    let filtered = sourceProducts;

    // Filter by search query - partial match where order matters (starts with)
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

    // Filter by favorites
    if (showFavoritesOnly) {
      filtered = filtered.filter(product => {
        const productId = String(product.product_id || product.id);
        return favorites.has(productId);
      });
    }

    // Filter by owned cards (inventory)
    if (showOwnedOnly) {
      filtered = filtered.filter(product => {
        const productId = String(product.product_id || product.id);
        const quantity = inventory[productId] || 0;
        return quantity > 0;
      });
    }

    // If not filtering to deck, apply "in deck" filter if enabled (for edit mode)
    if (!shouldFilterToDeck && showInDeckOnly) {
      filtered = filtered.filter(product => {
        const productId = String(product.product_id || product.id);
        const mergedQuantity = stagedDeckItems[productId] !== undefined 
          ? stagedDeckItems[productId] 
          : (deckItems[productId] || 0);
        return mergedQuantity > 0;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      
      if (sortOption === 'name-asc') {
        return aName.localeCompare(bName);
      } else if (sortOption === 'name-desc') {
        return bName.localeCompare(aName);
      }
      return 0;
    });

    setFilteredProducts(filtered);
    
    // Only reset displayedCount if filter parameters actually changed
    // Don't reset when deckItems/stagedDeckItems change (to preserve scroll position)
    const currentFilterState = {
      searchQuery,
      showFavoritesOnly,
      showInDeckOnly,
      showOwnedOnly,
      shouldFilterToDeck,
      sortOption,
      attributeFilters: JSON.stringify(attributeFilters), // Stringify for comparison
      productsLength: products.length,
      deckProductsLength: deckProducts.length
    };
    
    const prevState = prevFilterStateRef.current;
    
    // Only reset if:
    // 1. Search query changed
    // 2. Favorites filter toggled
    // 3. In-deck filter toggled
    // 4. Owned filter toggled
    // 5. Sort option changed
    // 6. Attribute filters changed
    // 7. Source switched between products and deckProducts (shouldFilterToDeck changed)
    // 8. Source list was completely replaced (length went to 0 or from 0)
    // Note: We don't reset when deckProducts length changes slightly (adding one card)
    const shouldReset = 
      currentFilterState.searchQuery !== prevState.searchQuery ||
      currentFilterState.showFavoritesOnly !== prevState.showFavoritesOnly ||
      currentFilterState.showInDeckOnly !== prevState.showInDeckOnly ||
      currentFilterState.showOwnedOnly !== prevState.showOwnedOnly ||
      currentFilterState.sortOption !== prevState.sortOption ||
      currentFilterState.attributeFilters !== prevState.attributeFilters ||
      currentFilterState.shouldFilterToDeck !== prevState.shouldFilterToDeck ||
      (currentFilterState.shouldFilterToDeck && 
       (prevState.deckProductsLength === 0 || currentFilterState.deckProductsLength === 0)) ||
      (!currentFilterState.shouldFilterToDeck && 
       (prevState.productsLength === 0 || currentFilterState.productsLength === 0));
    
    if (shouldReset) {
      setCurrentPage(1);
      loadProducts(1, false);
    }
    // Always update the ref to track current state
    prevFilterStateRef.current = currentFilterState;
    
    // Restore scroll position after DOM updates to prevent scroll loss
    // Only restore if we didn't reset (meaning it was just a deck item change)
    if (!shouldReset && scrollPositionRef.current > 0) {
      // Use multiple attempts to ensure scroll is restored after React re-renders
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
  }, [products, deckProducts, searchQuery, showFavoritesOnly, showInDeckOnly, showOwnedOnly, favorites, inventory, deckItems, stagedDeckItems, sortOption, user, deckList]);

  const loadDeckList = async () => {
    if (!deckListId) return;
    if (loadingDeckListRef.current) return; // Prevent duplicate calls
    if (lastDeckListIdRef.current === deckListId && deckList) return; // Already loaded

    try {
      loadingDeckListRef.current = true;
      lastDeckListIdRef.current = deckListId;
      setLoading(true);
      setError(null);
      // Pass userId only if user is logged in (for authenticated requests)
      const deck = await fetchDeckList(deckListId, user?.id || null);
      
      if (!deck) {
        setError('Deck not found');
        return;
      }

      setDeckList(deck);
      setDeckName(deck.name || '');
      
      // Convert items to map format
      const itemsMap = {};
      if (deck.items && typeof deck.items === 'object') {
        Object.entries(deck.items).forEach(([productId, quantity]) => {
          itemsMap[String(productId)] = quantity;
        });
      }
      setDeckItems(itemsMap);
      setStagedDeckItems({});
      
      // Initialize history
      setHistory([{ items: { ...itemsMap } }]);
      historyIndexRef.current = 0;
    } catch (err) {
      setError(err.message || 'Failed to load deck');
      console.error('Error loading deck list:', err);
      lastDeckListIdRef.current = null; // Reset on error
    } finally {
      setLoading(false);
      loadingDeckListRef.current = false;
    }
  };

  const loadFavorites = async () => {
    if (!user) return;
    
    try {
      const favs = await getFavorites(user.id);
      // getFavorites returns a Set, so we can use it directly
      if (favs instanceof Set) {
        setFavorites(favs);
      } else if (Array.isArray(favs)) {
        setFavorites(new Set(favs.map(f => String(f.product_id || f.id || f))));
      } else if (favs && typeof favs === 'object') {
        // If it's an object, try to extract an array
        const favArray = favs.favorites || favs.data || Object.values(favs);
        if (Array.isArray(favArray)) {
          setFavorites(new Set(favArray.map(f => String(f.product_id || f.id || f))));
        } else {
          setFavorites(new Set());
        }
      } else {
        setFavorites(new Set());
      }
    } catch (err) {
      console.error('Error loading favorites:', err);
      setFavorites(new Set());
    }
  };

  const loadInventory = async () => {
    if (!user) return;
    
    try {
      const inventoryMap = await getUserInventory(user.id);
      setInventory(inventoryMap);
    } catch (err) {
      console.error('Error loading inventory:', err);
      setInventory({});
    }
  };

  const loadCategoryRules = async () => {
    if (!deckList || !deckList.category_id) return;
    if (loadingCategoryRulesRef.current) return;
    
    try {
      loadingCategoryRulesRef.current = true;
      console.log('[loadCategoryRules] Fetching rules for category:', deckList.category_id);
      const rulesData = await fetchCategoryRules(deckList.category_id);
      console.log('[loadCategoryRules] Received rules data:', rulesData);
      
      // API returns either an array or a single object
      if (Array.isArray(rulesData) && rulesData.length > 0) {
        setCategoryRules(rulesData[0]);
        console.log('[loadCategoryRules] Set rules from array:', rulesData[0]);
      } else if (rulesData && typeof rulesData === 'object' && !Array.isArray(rulesData)) {
        // Single object response
        setCategoryRules(rulesData);
        console.log('[loadCategoryRules] Set rules from object:', rulesData);
      } else {
        console.warn('[loadCategoryRules] No rules found or invalid format:', rulesData);
        setCategoryRules(null);
      }
    } catch (err) {
      console.error('[loadCategoryRules] Error loading category rules:', err);
      setCategoryRules(null);
    } finally {
      loadingCategoryRulesRef.current = false;
    }
  };

  const loadDeckProductsForIds = async (productIds) => {
    if (productIds.length === 0) {
      setDeckProducts([]);
      return;
    }
    if (loadingDeckProductsRef.current) return;

    try {
      loadingDeckProductsRef.current = true;
      // Fetch in batches of 1000
      const batches = [];
      for (let i = 0; i < productIds.length; i += 1000) {
        batches.push(productIds.slice(i, i + 1000));
      }
      
      const allProducts = [];
      for (const batch of batches) {
        const batchProducts = await fetchProductsBulk(batch);
        allProducts.push(...batchProducts);
      }
      
      setDeckProducts(allProducts);
      // Extract extended data from products (now included in product objects)
      loadProductExtendedData(allProducts);
      
      // Fetch prices for all deck products and merge with existing prices
      if (allProducts.length > 0) {
        const productIds = allProducts
          .map(p => p.product_id || p.id)
          .filter(id => id !== undefined && id !== null);
        
        if (productIds.length > 0) {
          try {
            const prices = await fetchCurrentPricesBulk(productIds);
            // Merge with existing prices instead of replacing
            setProductPrices(prev => ({ ...prev, ...prices }));
          } catch (err) {
            console.error('Error loading prices:', err);
            // Don't clear all prices on error, just log it
          }
        }
      }
    } catch (err) {
      console.error('Error loading deck products:', err);
      setDeckProducts([]);
    } finally {
      loadingDeckProductsRef.current = false;
    }
  };

  // Fetch currency conversion rates (load when component mounts or when currency changes)

  // Convert USD value to selected currency
  const convertCurrency = (usdValue) => {
    if (selectedCurrency === 'usd' || !currencyRates) {
      return usdValue;
    }
    const rate = currencyRates[selectedCurrency];
    if (!rate) {
      return usdValue; // Fallback to USD if rate not found
    }
    return usdValue * rate;
  };

  // Format currency value with appropriate symbol/format
  const formatCurrency = (value) => {
    const convertedValue = convertCurrency(value);
    // Common currency symbols
    const currencySymbols = {
      'usd': '$',
      'eur': '€',
      'gbp': '£',
      'jpy': '¥',
      'cad': 'C$',
      'aud': 'A$',
      'chf': 'CHF ',
      'cny': '¥',
      'inr': '₹',
      'krw': '₩',
      'mxn': 'MX$',
      'brl': 'R$',
      'sek': 'kr ',
      'nok': 'kr ',
      'dkk': 'kr ',
      'pln': 'zł ',
      'rub': '₽',
      'zar': 'R ',
      'try': '₺',
      'nzd': 'NZ$',
      'hkd': 'HK$',
      'sgd': 'S$',
    };
    
    const symbol = currencySymbols[selectedCurrency.toLowerCase()] || selectedCurrency.toUpperCase() + ' ';
    return `${symbol}${convertedValue.toFixed(2)}`;
  };

  const loadProducts = async (page = 1, append = false) => {
    if (!deckList || !deckList.category_id) return;
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
        if (deckList.category_id && productsData.length > 0) {
          const categoryIdInt = deckList.category_id;
          productsData = productsData.filter(p => {
            const productCategoryId = p.category_id || p.categoryId;
            return productCategoryId === categoryIdInt;
          });
          total = productsData.length;
        }
      }
      // Check if we're filtering by favorites, owned, or in-deck - use bulk endpoint
      else if (showFavoritesOnly || showOwnedOnly || showInDeckOnly) {
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
        
        if (showInDeckOnly && Object.keys(deckItems).length > 0) {
          Object.keys(deckItems).forEach(productId => {
            if ((deckItems[productId] || 0) > 0) {
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
          if (deckList.category_id) {
            const categoryIdInt = deckList.category_id;
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
          category_id: deckList.category_id,
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
          // Use API's has_more if available, otherwise use calculated value
          setHasMorePages(calculatedHasMore);
          
          // Track newly added product IDs for animation
          const newProductIds = new Set(
            newProducts.map(p => String(p.product_id || p.id))
          );
          setNewlyAddedProductIds(newProductIds);
          
          // Clear animation class after animation completes
          setTimeout(() => {
            setNewlyAddedProductIds(new Set());
          }, 600); // Match animation duration
          
          return updatedProducts;
        });
      } else {
        // Replace products (new search/filter)
        setProducts(productsData);
        // Use API's has_more field if available, otherwise calculate from total
        const itemsLoaded = productsData.length;
        const calculatedHasMore = total > 0 ? itemsLoaded < total : hasMore;
        // Use API's has_more if available, otherwise use calculated value
        setHasMorePages(calculatedHasMore);
        // Reset newly added IDs when replacing
        setNewlyAddedProductIds(new Set());
      }
      
      setTotalCount(total);
      setCurrentPage(pageNum);
      
      // Extract extended data from products
      loadProductExtendedData(productsData);
      
      // Fetch prices for new products
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
            
            // Always merge prices to preserve prices for deck products even when filtering
            setProductPrices(prev => ({ ...prev, ...allPrices }));
          } catch (err) {
            console.error('Error loading prices for filtered products:', err);
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
      }
    } finally {
      if (!append) {
        setLoading(false);
        loadingProductsRef.current = false;
      } else {
        setLoadingMore(false);
      }
    }
  };

  const loadMoreProducts = async () => {
    if (loadingMore || !hasMorePages) return;
    const nextPage = currentPage + 1;
    await loadProducts(nextPage, true);
  };

  const loadGroups = async () => {
    if (!deckList || !deckList.category_id) return;
    if (loadingGroupsRef.current) return;

    try {
      loadingGroupsRef.current = true;
      setLoadingGroups(true);
      const data = await fetchGroupsByCategory(deckList.category_id);
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading groups:', err);
      setGroups([]);
    } finally {
      setLoadingGroups(false);
      loadingGroupsRef.current = false;
    }
  };

  const loadAttributes = useCallback(async () => {
    if (!deckList || !deckList.category_id) {
      console.log('[loadAttributes] No deckList or category_id, skipping');
      return;
    }
    if (loadingAttributesRef.current) {
      console.log('[loadAttributes] Already loading, skipping');
      return;
    }

    const categoryId = String(deckList.category_id);
    console.log(`[loadAttributes] Loading attributes for category ${categoryId}`);
    
    // Check cache first
    if (categoryAttributesCache[categoryId]) {
      console.log(`[loadAttributes] Using cached attributes for category ${categoryId}`);
      const cached = categoryAttributesCache[categoryId];
      setCategoryKeys(cached.keys || []);
      setAttributeValues(cached.values || {});
      setLoadingAttributes(false);
      console.log(`[loadAttributes] Cached keys:`, cached.keys);
      return;
    }

    try {
      loadingAttributesRef.current = true;
      setLoadingAttributes(true);
      console.log(`[loadAttributes] Fetching from API for category ${deckList.category_id}`);
      const keyValuesData = await fetchProductExtendedDataKeyValues(deckList.category_id);
      console.log(`[loadAttributes] API response:`, keyValuesData);
      
      const keyValuePairs = keyValuesData.key_value_pairs || keyValuesData.keyValuePairs || {};
      const keys = keyValuesData.keys || Object.keys(keyValuePairs);
      console.log(`[loadAttributes] Keys from response:`, keys);
      console.log(`[loadAttributes] Key-value pairs:`, keyValuePairs);
      
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
      
      const valuesObj = {};
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
      
      setCategoryKeys(sortedKeys);
      setAttributeValues(valuesObj);
      
      setCategoryAttributesCache(prev => ({
        ...prev,
        [categoryId]: { keys: sortedKeys, values: valuesObj }
      }));
    } catch (err) {
      console.error('[loadAttributes] Error loading attributes:', err);
      setCategoryKeys([]);
      setAttributeValues({});
    } finally {
      setLoadingAttributes(false);
      loadingAttributesRef.current = false;
      console.log(`[loadAttributes] Finished loading, categoryKeys.length: ${categoryKeys.length}`);
    }
  }, [deckList?.category_id, categoryAttributesCache]);

  const handleAddToDeck = (e, productId) => {
    e.stopPropagation();
    // Prevent editing if not owner
    if (!user || !deckList || deckList.user_id !== user.id) return;
    
    const productIdStr = String(productId);
    
    // Check if adding this card would violate rules
    const currentQuantity = stagedDeckItems[productIdStr] !== undefined 
      ? stagedDeckItems[productIdStr] 
      : (deckItems[productIdStr] || 0);
    const newQuantity = currentQuantity + 1;
    
    // Check max_duplicates rule
    if (categoryRules && categoryRules.max_duplicates !== null && categoryRules.max_duplicates !== undefined) {
      if (newQuantity > categoryRules.max_duplicates) {
        setNotification({
          isOpen: true,
          title: 'Cannot Add Card',
          message: `Cannot add more copies. Maximum ${categoryRules.max_duplicates} copies allowed per card.`,
          type: 'error'
        });
        return;
      }
    }
    
    // Note: Deck size limit check removed - users can now exceed the limit
    // Visual indicators will show when the limit is exceeded
    
    // Save to history before making change
    saveToHistory();
    
    setStagedDeckItems(prev => {
      return {
        ...prev,
        [productIdStr]: newQuantity
      };
    });
  };

  const handleImportDeck = async (importText) => {
    // Prevent editing if not owner
    if (!user || !deckList || deckList.user_id !== user.id) {
      setNotification({
        isOpen: true,
        title: 'Import Failed',
        message: 'You do not have permission to edit this deck.',
        type: 'error'
      });
      return;
    }

    if (!deckList || !deckList.category_id) {
      setNotification({
        isOpen: true,
        title: 'Import Failed',
        message: 'Deck category information is missing.',
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
        deckList.category_id,
        cardNumbersToFind
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

      // Apply import (exact quantities for deck)
      const newStagedItems = applyImportExact(deckItems, stagedDeckItems, importedItems);

      // Save to history before making changes
      saveToHistory();

      // Apply staged changes
      setStagedDeckItems(newStagedItems);

      // Show success message
      const addedCount = Object.values(importedItems).reduce((sum, qty) => sum + qty, 0);
      const currentMerged = getMergedItems(deckItems, stagedDeckItems);
      const removedCount = Object.keys(currentMerged).filter(id => !importedItems[id] && currentMerged[id] > 0).length;
      let message = `Import successful! ${Object.keys(importedItems).length} card type(s) imported, ${addedCount} total card(s).`;
      if (removedCount > 0) {
        message += ` ${removedCount} card type(s) will be removed.`;
      }
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
        message: 'Error importing deck. Please try again.',
        type: 'error'
      });
    }
  };

  const handleRemoveFromDeck = (e, productId) => {
    e.stopPropagation();
    // Prevent editing if not owner
    if (!user || !deckList || deckList.user_id !== user.id) return;
    
    const productIdStr = String(productId);
    
    // Save to history before making change
    saveToHistory();
    
    setStagedDeckItems(prev => {
      const current = prev[productIdStr] !== undefined 
        ? prev[productIdStr] 
        : (deckItems[productIdStr] || 0);
      
      if (current <= 1) {
        // Mark for deletion by setting to 0 (or removing if not in original deckItems)
        const newStaged = { ...prev };
        if (deckItems[productIdStr] && deckItems[productIdStr] > 0) {
          // Card exists in deck, mark for deletion
          newStaged[productIdStr] = 0;
        } else {
          // Card was only in staged, remove it completely
          delete newStaged[productIdStr];
        }
        return newStaged;
      } else {
        return {
          ...prev,
          [productIdStr]: current - 1
        };
      }
    });
  };

  const saveToHistory = () => {
    const currentState = {
      items: { ...deckItems, ...stagedDeckItems }
    };
    
    // Remove any future history if we're not at the end
    const newHistory = history.slice(0, historyIndexRef.current + 1);
    newHistory.push(currentState);
    setHistory(newHistory);
    historyIndexRef.current = newHistory.length - 1;
  };


  const handleDiscard = () => {
    setConfirmation({
      isOpen: true,
      title: 'Discard Changes',
      message: 'Are you sure you want to discard all changes? This cannot be undone.',
      onConfirm: () => {
        setStagedDeckItems({});
        // Reset to original deck items
        const originalState = history[0];
        setDeckItems(originalState.items);
        setHistory([originalState]);
        historyIndexRef.current = 0;
        setConfirmation({ isOpen: false, title: '', message: '', onConfirm: null });
      }
    });
  };

  // Calculate delta breakdown for confirmation modal
  const calculateDelta = () => {
    return calculateDeltaUtil(deckItems, stagedDeckItems);
  };

  // Actual apply logic (called after confirmation)
  const applyDeckChanges = async () => {
    if (!user || !deckListId) return;

    try {
      setIsUpdatingDeck(true);
      
      const { addedItems, updatedItems, removedItems, mergedItems } = calculateDelta();

      // Validate deck before applying changes (but allow saving even with warnings)
      const errors = validateDeck(mergedItems);
      // Filter out deck_size errors - we allow exceeding the limit
      const blockingErrors = errors.filter(error => !error.includes('exceeds maximum size'));
      
      if (blockingErrors.length > 0) {
        setNotification({
          isOpen: true,
          title: 'Deck Validation Failed',
          message: `Cannot apply changes. Deck validation failed:\n\n${blockingErrors.join('\n')}`,
          type: 'error'
        });
        setIsUpdatingDeck(false);
        setShowDeltaConfirmation(false);
        return;
      }
      
      // Show warning if deck exceeds size limit, but allow saving
      const sizeErrors = errors.filter(error => error.includes('exceeds maximum size'));
      if (sizeErrors.length > 0) {
        setNotification({
          isOpen: true,
          title: 'Deck Exceeds Limit',
          message: `Warning: ${sizeErrors[0]}. You can still save the deck.`,
          type: 'warning'
        });
      }

      // Combine added and updated items for the update API call
      const itemsToUpdate = { ...addedItems };
      Object.entries(updatedItems).forEach(([productId, { newQuantity }]) => {
        itemsToUpdate[productId] = newQuantity;
      });

      const itemsToDelete = removedItems.map(id => parseInt(id, 10));

      // Perform updates
      if (Object.keys(itemsToUpdate).length > 0) {
        await updateDeckListItems(deckListId, user.id, itemsToUpdate);
      }

      // Perform deletes
      if (itemsToDelete.length > 0) {
        await deleteDeckListItems(deckListId, user.id, itemsToDelete);
      }

      // Update deckItems optimistically with merged items before reload
      setDeckItems(mergedItems);
      
      // Clear staged changes immediately to reset delta badge
      setStagedDeckItems({});
      
      // Update history with new state
      setHistory([{ items: { ...mergedItems } }]);
      historyIndexRef.current = 0;

      // Force reload deck list to sync with server
      lastDeckListIdRef.current = null; // Force reload by clearing the cache
      loadingDeckListRef.current = false; // Reset guard to allow reload
      await loadDeckList();

      setShowDeltaConfirmation(false);
    } catch (err) {
      console.error('Error applying deck changes:', err);
      setNotification({
        isOpen: true,
        title: 'Error',
        message: 'Failed to apply changes. Please try again.',
        type: 'error'
      });
      setShowDeltaConfirmation(false);
    } finally {
      setIsUpdatingDeck(false);
    }
  };

  const handleApply = () => {
    if (!user || !deckListId) return;
    
    // Calculate delta and show confirmation
    const { addedItems, updatedItems, removedItems } = calculateDelta();
    const hasChanges = Object.keys(addedItems).length > 0 || 
                      Object.keys(updatedItems).length > 0 || 
                      removedItems.length > 0;
    
    if (!hasChanges) {
      setNotification({
        isOpen: true,
        title: 'No Changes',
        message: 'There are no changes to apply.',
        type: 'info'
      });
      return;
    }

    setShowDeltaConfirmation(true);
  };

  const handleDiscardChanges = () => {
    setStagedDeckItems({});
    setShowDeltaConfirmation(false);
  };

  const handleDeckNameSave = async () => {
    if (!user || !deckListId || !deckName.trim()) return;

    try {
      await updateDeckListName(deckListId, user.id, deckName.trim());
      setEditingDeckName(false);
      
      // Optimistically update the deckList state immediately
      if (deckList) {
        setDeckList({
          ...deckList,
          name: deckName.trim()
        });
      }
      
      // Reload deck to sync with server (in background)
      loadingDeckListRef.current = false; // Reset guard to allow reload
      loadDeckList().catch(err => {
        console.error('Error reloading deck after name update:', err);
        // If reload fails, revert to server state
        loadingDeckListRef.current = false;
        loadDeckList();
      });
    } catch (err) {
      console.error('Error updating deck name:', err);
      setNotification({
        isOpen: true,
        title: 'Error',
        message: 'Failed to update deck name. Please try again.',
        type: 'error'
      });
    }
  };

  const handleFavoriteToggle = async (e, productId) => {
    e.stopPropagation();
    if (!user) return;

    try {
      await toggleFavorite(user.id, productId);
      const newFavorites = new Set(favorites);
      if (newFavorites.has(String(productId))) {
        newFavorites.delete(String(productId));
      } else {
        newFavorites.add(String(productId));
      }
      setFavorites(newFavorites);
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  const handleGroupFilter = (groupId) => {
    setSelectedGroupId(groupId);
  };

  const handleAttributeFilter = (key, value) => {
    // Update pending filters instead of applying immediately
    setPendingAttributeFilters(prev => {
      const newFilters = { ...prev };
      // Handle backward compatibility: convert single value to array if needed
      const currentValue = newFilters[key];
      const currentValues = Array.isArray(currentValue) 
        ? currentValue 
        : (currentValue ? [currentValue] : []);
      
      if (currentValues.includes(value)) {
        // Remove value from array
        const updatedValues = currentValues.filter(v => v !== value);
        if (updatedValues.length === 0) {
          delete newFilters[key];
        } else {
          newFilters[key] = updatedValues;
        }
      } else {
        // Add value to array
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

  // Removed unused handlers - search and sort are handled inline
  // const handleSearchChange = (e) => {
  //   setSearchQuery(e.target.value);
  // };

  // const handleSortChange = (e) => {
  //   setSortOption(e.target.value);
  // };

  const navigateWithCheck = (to) => {
    const isOwner = user && deckList && deckList.user_id === user.id;
    if (isOwner && hasStagedChanges) {
      pendingNavigationRef.current = to;
      setConfirmation({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to leave?',
        onConfirm: () => {
          if (pendingNavigationRef.current) {
            navigate(pendingNavigationRef.current);
            pendingNavigationRef.current = null;
          }
        }
      });
    } else {
      navigate(to);
    }
  };

  // Extract extended data from products (now included in product objects)
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

  // Get rarity from product extended data
  const getRarity = (product) => {
    const extendedData = extractExtendedDataFromProduct(product);
    const rarityItem = extendedData.find(item => {
      const key = (item.key || item.name || '').toUpperCase();
      return key === 'RARITY';
    });
    if (!rarityItem) return null;
    
    let rarity = (rarityItem.value || rarityItem.val || '').trim().toUpperCase();
    // Normalize "Legend Rare" to "LR"
    if (rarity === 'LEGEND RARE' || rarity === 'LEGENDRARE') {
      rarity = 'LR';
    }
    return rarity;
  };

  // Removed unused getRarityBorderStyle function - rarity styling handled via CSS

  // Convert color name/text to CSS color value
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

  // Determine if a color is light or dark, returns 'light' or 'dark'
  // Only returns 'light' for white/very light colors (high R, G, B values)
  // This prevents bright saturated colors (like green) from being treated as light
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
    // This ensures only white/very light colors use gray text, not bright saturated colors
    return (r > 240 && g > 240 && b > 240) ? 'light' : 'dark';
  };

  // Extract product attributes from extended data
  // First tries to get from product object's extended_data_raw (JSON string), then falls back to productExtendedData state
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

  // Check if a specific product violates max_duplicates rule
  const checkMaxDuplicatesViolation = (productId, quantity) => {
    if (!categoryRules) {
      return false;
    }
    if (categoryRules.max_duplicates === null || categoryRules.max_duplicates === undefined) {
      return false;
    }
    const mergedItems = { ...deckItems, ...stagedDeckItems };
    const currentQuantity = mergedItems[String(productId)] || 0;
    const violates = currentQuantity > categoryRules.max_duplicates;
    if (violates) {
      console.log(`[checkMaxDuplicatesViolation] Product ${productId}: ${currentQuantity} > ${categoryRules.max_duplicates}`);
    }
    return violates;
  };

  // Check if a specific product's extended attributes violate extended_rules
  const checkExtendedRulesViolation = (productId) => {
    if (!categoryRules) {
      return null;
    }
    if (!categoryRules.extended_rules || typeof categoryRules.extended_rules !== 'object') {
      return null; // No extended rules or no violation
    }
    
    const mergedItems = { ...deckItems, ...stagedDeckItems };
    const extendedRules = categoryRules.extended_rules;
    const violations = [];
    
    // Get this product's extended data
    const prodExtData = productExtendedData[productId] || [];
    
    // Check each extended rule
    Object.keys(extendedRules).forEach(ruleKey => {
      const maxUnique = extendedRules[ruleKey];
      if (maxUnique === null || maxUnique === undefined) return;
      
      // Find this product's value for this rule key
      let productValue = null;
      prodExtData.forEach(item => {
        const key = item.key || item.name;
        const value = item.value || item.val;
        if (key && value && key.toUpperCase() === ruleKey.toUpperCase()) {
          productValue = value;
        }
      });
      
      if (!productValue) return; // This product doesn't have this attribute
      
      // Count unique values across all products in deck
      const uniqueValues = new Set();
      Object.keys(mergedItems).forEach(pid => {
        if (mergedItems[pid] <= 0) return;
        
        const extData = productExtendedData[pid] || [];
        extData.forEach(item => {
          const key = item.key || item.name;
          const value = item.value || item.val;
          if (key && value && key.toUpperCase() === ruleKey.toUpperCase()) {
            uniqueValues.add(value);
          }
        });
      });
      
      if (uniqueValues.size > maxUnique) {
        violations.push({
          ruleKey,
          currentCount: uniqueValues.size,
          maxAllowed: maxUnique
        });
      }
    });
    
    return violations.length > 0 ? violations : null;
  };

  // Validate deck against category rules
  const validateDeck = (items) => {
    const errors = [];
    if (!categoryRules) {
      console.log('[validateDeck] No category rules available');
      return errors; // No rules to validate against
    }
    
    console.log('[validateDeck] Validating with rules:', {
      max_duplicates: categoryRules.max_duplicates,
      extended_rules: categoryRules.extended_rules
    });
    
    const mergedItems = { ...items };
    
    // Validate max_duplicates
    if (categoryRules.max_duplicates !== null && categoryRules.max_duplicates !== undefined) {
      Object.entries(mergedItems).forEach(([productId, quantity]) => {
        if (quantity > categoryRules.max_duplicates) {
          const product = deckProducts.find(p => String(p.product_id || p.id) === productId);
          const productName = product?.name || `Card ${productId}`;
          const errorMsg = `${productName}: ${quantity} copies exceeds maximum of ${categoryRules.max_duplicates}`;
          console.log('[validateDeck] Max duplicates violation:', errorMsg);
          errors.push(errorMsg);
        }
      });
    }
    
    // Validate extended_rules
    if (categoryRules.extended_rules && typeof categoryRules.extended_rules === 'object') {
      const extendedRules = categoryRules.extended_rules;
      console.log('[validateDeck] Checking extended_rules:', extendedRules);
      
      // Count unique attribute values for each rule key
      Object.keys(extendedRules).forEach(ruleKey => {
        const maxUnique = extendedRules[ruleKey];
        if (maxUnique === null || maxUnique === undefined) return;
        
        const uniqueValues = new Set();
        
        // Check each product in the deck
        Object.keys(mergedItems).forEach(productId => {
          if (mergedItems[productId] <= 0) return;
          
          const extData = productExtendedData[productId] || [];
          extData.forEach(item => {
            const key = item.key || item.name;
            const value = item.value || item.val;
            
            if (key && value && key.toUpperCase() === ruleKey.toUpperCase()) {
              uniqueValues.add(value);
            }
          });
        });
        
        console.log(`[validateDeck] ${ruleKey}: ${uniqueValues.size} unique values (max: ${maxUnique})`);
        if (uniqueValues.size > maxUnique) {
          const errorMsg = `${ruleKey}: ${uniqueValues.size} unique values exceeds maximum of ${maxUnique}`;
          console.log('[validateDeck] Extended rules violation:', errorMsg);
          errors.push(errorMsg);
        }
      });
    }
    
    return errors;
  };

  // Calculate total cards in deck
  const getTotalCards = () => {
    const merged = { ...deckItems, ...stagedDeckItems };
    return Object.values(merged).reduce((sum, qty) => sum + qty, 0);
  };

  // Calculate delta of staged changes
  const getStagedDelta = () => {
    if (Object.keys(stagedDeckItems).length === 0) {
      return 0;
    }

    // Calculate total cards before staging
    const originalTotal = Object.values(deckItems).reduce((sum, qty) => sum + qty, 0);
    
    // Calculate total cards after staging
    const merged = { ...deckItems, ...stagedDeckItems };
    const newTotal = Object.values(merged)
      .filter(qty => qty > 0)
      .reduce((sum, qty) => sum + qty, 0);
    
    return newTotal - originalTotal;
  };

  const hasStagedChanges = Object.keys(stagedDeckItems).length > 0;

  // Validate deck whenever staged items or extended data changes
  useEffect(() => {
    console.log('[validateDeck useEffect] categoryRules:', categoryRules);
    if (!categoryRules) {
      console.log('[validateDeck useEffect] No category rules, clearing errors');
      setValidationErrors([]);
      return;
    }
    
    const mergedItems = { ...deckItems, ...stagedDeckItems };
    console.log('[validateDeck useEffect] Validating deck with', Object.keys(mergedItems).length, 'products');
    const errors = validateDeck(mergedItems);
    console.log('[validateDeck useEffect] Validation errors:', errors.length, errors);
    setValidationErrors(errors);
  }, [deckItems, stagedDeckItems, categoryRules, productExtendedData, deckProducts]);

  // Check if user is the owner of the deck (for editing permissions)
  const isOwner = user && deckList && deckList.user_id === user.id;
  const canEdit = isOwner; // Only owner can edit

  if (loading && !deckList) {
    return (
      <div className="deck-builder-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading deck...</p>
        </div>
      </div>
    );
  }

  if (error || !deckList) {
    return (
      <div className="deck-builder-page">
        <div className="error-state">
          <p className="error-message">⚠️ {error || 'Deck not found'}</p>
          <button onClick={() => navigate('/deck-lists')} className="retry-button">
            Back to Deck Lists
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deck-builder-page">
      <NavigationBar className="deck-builder-header" />

      <main className="deck-builder-main">
        {/* Floating Toggle Button - Show for all users */}
        <button 
          className="mobile-sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Open deck sidebar' : 'Close deck sidebar'}
        >
          <span className="mobile-toggle-icon">📋</span>
          {canEdit && hasStagedChanges && (() => {
            const delta = getStagedDelta();
            const deltaClass = delta > 0 ? 'delta-positive' : delta < 0 ? 'delta-negative' : 'delta-zero';
            return (
              <span className={`mobile-toggle-badge ${deltaClass}`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            );
          })()}
        </button>

        {/* Sidebar Overlay */}
        {!sidebarCollapsed && (
          <div 
            className={`mobile-sidebar-overlay ${!sidebarCollapsed ? 'active' : ''}`}
            onClick={() => setSidebarCollapsed(true)}
          />
        )}

        <div className="deck-builder-layout">
          {/* Sidebar - Show for all users */}
          <aside className={`deck-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${!sidebarCollapsed ? 'mobile-expanded' : ''}`}>
            {/* Close button */}
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
              <h3 className={(() => {
                if (categoryRules?.deck_size) {
                  const totalCards = getTotalCards();
                  if (totalCards > categoryRules.deck_size) {
                    return 'deck-over-limit';
                  }
                }
                return '';
              })()}>
                {deckList?.name || 'Untitled Deck'} ({getTotalCards()}{categoryRules?.deck_size ? ` / ${categoryRules.deck_size}` : ''})
                {(() => {
                  if (categoryRules?.deck_size) {
                    const totalCards = getTotalCards();
                    if (totalCards > categoryRules.deck_size) {
                      return <span className="over-limit-indicator" title={`Deck exceeds limit by ${totalCards - categoryRules.deck_size} card${totalCards - categoryRules.deck_size !== 1 ? 's' : ''}`}> ⚠️</span>;
                    }
                  }
                  return null;
                })()}
              </h3>
              <button
                className="sidebar-export-button"
                onClick={() => setShowExportModal(true)}
                title="Export deck list"
              >
                📤
              </button>
            </div>
            
            {!sidebarCollapsed && (
              <>
                <div className="sidebar-content">
                  {(() => {
                    const cardsInDeck = buildSidebarItems(
                      deckProducts,
                      deckItems,
                      stagedDeckItems,
                      getProductAttributes,
                      'attributes'
                    );

                    return (
                      <SidebarCardList
                        items={cardsInDeck}
                        getProductAttributes={getProductAttributes}
                        getColorBrightness={getColorBrightness}
                        productPrices={productPrices}
                        formatCurrency={formatCurrency}
                        maxPercentage={maxPercentage}
                        onAddClick={canEdit ? handleAddToDeck : null}
                        onRemoveClick={canEdit ? handleRemoveFromDeck : null}
                        canEdit={canEdit}
                        emptyMessage="No cards in deck yet"
                      />
                    );
                  })()}
                </div>

                {/* Distribution Histograms */}
                {(() => {
                  // Calculate frequencies for all three metrics
                  const costFrequency = {};
                  const levelFrequency = {};
                  const cardTypeFrequency = {};
                  let totalCards = 0;
                  let maxCost = 0;
                  let maxLevel = 0;
                  
                  deckProducts.forEach(product => {
                    const productId = String(product.product_id || product.id);
                    const quantity = stagedDeckItems[productId] !== undefined 
                      ? stagedDeckItems[productId] 
                      : (deckItems[productId] || 0);
                    
                    if (quantity > 0) {
                      const attributes = getProductAttributes(productId, product);
                      
                      // Cost
                      const cost = attributes.cost;
                      if (cost !== null && cost !== undefined) {
                        const costNum = parseInt(cost, 10);
                        if (!isNaN(costNum)) {
                          const costKey = String(costNum);
                          costFrequency[costKey] = (costFrequency[costKey] || 0) + quantity;
                          maxCost = Math.max(maxCost, costNum);
                        }
                      }
                      
                      // Level
                      const level = attributes.level;
                      if (level !== null && level !== undefined) {
                        const levelNum = parseInt(level, 10);
                        if (!isNaN(levelNum)) {
                          const levelKey = String(levelNum);
                          levelFrequency[levelKey] = (levelFrequency[levelKey] || 0) + quantity;
                          maxLevel = Math.max(maxLevel, levelNum);
                        }
                      }
                      
                      // CardType
                      const cardType = attributes.cardType;
                      if (cardType) {
                        cardTypeFrequency[cardType] = (cardTypeFrequency[cardType] || 0) + quantity;
                      }
                      
                      totalCards += quantity;
                    }
                  });

                  // Prepare data for each tab
                  const maxCostValue = Math.max(maxCost, 10);
                  const allCosts = [];
                  for (let i = 0; i <= maxCostValue; i++) {
                    allCosts.push(i);
                  }

                  const maxLevelValue = Math.max(maxLevel, 10);
                  const allLevels = [];
                  for (let i = 0; i <= maxLevelValue; i++) {
                    allLevels.push(i);
                  }

                  // Only show these specific card types: Base, Command, Pilot, Unit
                  const sortedCardTypes = ['Base', 'Command', 'Pilot', 'Unit'];

                  // Calculate total deck value (sum of market_price * quantity for each card)
                  let totalDeckValue = 0;
                  deckProducts.forEach(product => {
                    const productId = String(product.product_id || product.id);
                    const quantity = stagedDeckItems[productId] !== undefined 
                      ? stagedDeckItems[productId] 
                      : (deckItems[productId] || 0);
                    
                    if (quantity > 0) {
                      const price = productPrices[parseInt(productId, 10)];
                      const marketPrice = price?.market_price || price?.marketPrice;
                      if (marketPrice !== null && marketPrice !== undefined) {
                        const priceNum = typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice);
                        if (!isNaN(priceNum)) {
                          totalDeckValue += priceNum * quantity;
                        }
                      }
                    }
                  });

                  // Calculate values at different percentage thresholds
                  const valuePercentages = [100, 95, 90, 85, 80, 75, 70];
                  const valueData = valuePercentages
                    .filter(percentage => percentage <= maxPercentage)
                    .map(percentage => ({
                      percentage,
                      value: totalDeckValue * (percentage / 100)
                    }));

                  return (
                    <DistributionHistograms
                      histogramTab={histogramTab}
                      setHistogramTab={setHistogramTab}
                      histogramsMinimized={histogramsMinimized}
                      setHistogramsMinimized={setHistogramsMinimized}
                      histogramsExpanded={histogramsExpanded}
                      setHistogramsExpanded={setHistogramsExpanded}
                      costFrequency={costFrequency}
                      levelFrequency={levelFrequency}
                      cardTypeFrequency={cardTypeFrequency}
                      valueData={valueData}
                      allCosts={allCosts}
                      allLevels={allLevels}
                      sortedCardTypes={sortedCardTypes}
                      totalCards={totalCards}
                      totalValue={totalDeckValue}
                      maxPercentage={maxPercentage}
                      setMaxPercentage={setMaxPercentage}
                      selectedCurrency={selectedCurrency}
                      setSelectedCurrency={setSelectedCurrency}
                      loadingRates={loadingRates}
                      currencyRates={currencyRates}
                      formatCurrency={formatCurrency}
                      categoryRules={categoryRules}
                      availableTabs={['cost', 'level', 'cardType', 'value']}
                    />
                  );
                })()}
                
                {/* Validation Errors */}
                {validationErrors.length > 0 && (
                  <div className="validation-errors">
                    <h4 className="validation-errors-title">⚠️ Deck Validation Errors</h4>
                    <ul className="validation-errors-list">
                      {validationErrors.map((error, index) => (
                        <li key={index} className="validation-error-item">{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action buttons - Only show if user can edit */}
                {canEdit && (
                  <div className="sidebar-actions">
                    {hasStagedChanges && !isUpdatingDeck && (
                      <button
                        className="discard-button"
                        onClick={handleDiscard}
                      >
                        Discard
                      </button>
                    )}
                    {hasStagedChanges && !isUpdatingDeck && validationErrors.length === 0 && (
                      <button
                        className="apply-button"
                        onClick={handleApply}
                      >
                        {isUpdatingDeck ? 'Applying...' : 'Apply'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>

          {/* Main Content - Reuse ProductsPage structure */}
          <div className="deck-builder-content">
            {/* Deck Name Header */}
            <PageHeader
              title={deckList?.name || 'Unnamed Deck'}
              editing={canEdit && editingDeckName}
              editValue={deckName}
              onEditChange={(value) => setDeckName(value)}
              onEditSave={handleDeckNameSave}
              onEditCancel={() => {
                setDeckName(deckList.name || '');
                setEditingDeckName(false);
              }}
              showEditButton={canEdit && !editingDeckName}
              onEditClick={() => setEditingDeckName(true)}
              actions={
                <button 
                  className="import-export-button-header" 
                  onClick={() => setShowExportModal(true)}
                  title="Export deck list"
                >
                  📤 Import/Export
                </button>
              }
              badge={canEdit ? 'Deck Builder Mode' : 'View Mode'}
              maxPercentage={maxPercentage}
              setMaxPercentage={setMaxPercentage}
              className="deck-name-header"
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
              showInDeckOnly={showInDeckOnly}
              setShowInDeckOnly={setShowInDeckOnly}
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
              canEdit={canEdit}
              
              // Product rendering props
              getQuantity={(productIdStr) => {
                return stagedDeckItems[productIdStr] !== undefined 
                  ? stagedDeckItems[productIdStr] 
                  : (deckItems[productIdStr] || 0);
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
              onAddToDeck={handleAddToDeck}
              onRemoveFromDeck={handleRemoveFromDeck}
              handleGroupFilter={handleGroupFilter}
              handleAttributeFilter={handleAttributeFilter}
              handleApplyAttributeFilters={handleApplyAttributeFilters}
              handleClearPendingFilters={handleClearPendingFilters}
              toggleAttributeGroup={toggleAttributeGroup}
              
              // Custom render props
              renderProductCardActions={(product, productId, productIdStr, quantity, isFavorited) => {
                if (!user && !canEdit) return null;
                return (
                  <div className="deck-controls">
                    {canEdit && (
                      <div className="deck-buttons">
                        <button
                          className="deck-add-button"
                          onClick={(e) => handleAddToDeck(e, productId)}
                          title="Add to deck"
                        >
                          +
                        </button>
                        {quantity > 0 && (
                          <button
                            className="deck-remove-button"
                            onClick={(e) => handleRemoveFromDeck(e, productId)}
                            title="Remove from deck"
                          >
                            −
                          </button>
                        )}
                      </div>
                    )}
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
                const productId = String(product.product_id || product.id);
                const classes = [];
                if (quantity > 0) {
                  classes.push('in-deck-card');
                }
                // Check for rule violations
                if (checkMaxDuplicatesViolation(productId, quantity)) {
                  classes.push('rule-violation-max-duplicates');
                }
                const extViolations = checkExtendedRulesViolation(productId);
                if (extViolations) {
                  classes.push('rule-violation-extended');
                }
                return classes.join(' ');
              }}
              renderProductCardBadges={(product, quantity) => {
                if (quantity <= 0) return null;
                const productId = String(product.product_id || product.id);
                const badges = [];
                
                // Max duplicates violation badge - only show if violation exists
                if (checkMaxDuplicatesViolation(productId, quantity)) {
                  const mergedItems = { ...deckItems, ...stagedDeckItems };
                  const currentQty = mergedItems[productId] || 0;
                  badges.push(
                    <div key="max-dup" className="rule-violation-badge rule-violation-badge-max-duplicates" 
                         title={`Exceeds max duplicates: ${currentQty} > ${categoryRules?.max_duplicates}`}>
                      {currentQty}/{categoryRules?.max_duplicates}
                    </div>
                  );
                }
                
                // Extended rules violation badge - only show if violation exists
                const extViolations = checkExtendedRulesViolation(productId);
                if (extViolations) {
                  extViolations.forEach((violation, idx) => {
                    badges.push(
                      <div key={`ext-${idx}`} className="rule-violation-badge rule-violation-badge-extended"
                           title={`${violation.ruleKey}: ${violation.currentCount} unique values exceeds maximum of ${violation.maxAllowed}`}>
                        {violation.ruleKey}
                      </div>
                    );
                  });
                }
                
                return badges.length > 0 ? <div className="rule-violation-badges">{badges}</div> : null;
              }}
            />
          </div>
        </div>
      </main>

      {/* Product Preview Modal */}
      <ProductPreviewModal
        productId={previewProductId}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewProductId(null);
        }}
        navigateWithCheck={navigateWithCheck}
      />

      {/* Notification Modal */}
      <NotificationModal
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmation.isOpen}
        onClose={() => {
          setConfirmation({ ...confirmation, isOpen: false, onConfirm: null });
          pendingNavigationRef.current = null;
        }}
        onConfirm={confirmation.onConfirm || (() => {})}
        title={confirmation.title}
        message={confirmation.message}
      />

      <ExportDeckModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        deckName={deckList?.name || 'Untitled Deck'}
        deckItems={(() => {
          // Merge staged and current deck items
          const merged = { ...deckItems };
          Object.entries(stagedDeckItems).forEach(([productId, quantity]) => {
            if (quantity > 0) {
              merged[productId] = quantity;
            } else {
              delete merged[productId];
            }
          });
          return merged;
        })()}
        deckProducts={deckProducts}
        onImport={handleImportDeck}
        canEdit={user && deckList && deckList.user_id === user.id}
        isImporting={isImporting}
      />

      {/* Deck Delta Confirmation Modal */}
      {(() => {
        const { addedItems, updatedItems, removedItems } = calculateDelta();
        // Create products map for lookup
        const productsMap = {};
        deckProducts.forEach(product => {
          const productId = String(product.product_id || product.id);
          productsMap[productId] = product;
        });
        
        return (
          <DeckDeltaConfirmation
            isOpen={showDeltaConfirmation}
            onClose={() => setShowDeltaConfirmation(false)}
            onConfirm={applyDeckChanges}
            onDiscard={handleDiscardChanges}
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

export default DeckBuilderPage;

