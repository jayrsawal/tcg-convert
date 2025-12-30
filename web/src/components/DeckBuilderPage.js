import React, { useState, useEffect, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useTCGPercentage } from '../contexts/TCGPercentageContext';
import { getFavorites, toggleFavorite } from '../lib/favorites';
import { getUserInventory } from '../lib/inventory';
import { fetchDeckList, createDeckList, updateDeckListName, updateDeckListItems, deleteDeckListItems, fetchCategoryRules } from '../lib/api';
import { fetchGroupsByCategory, fetchProductExtendedDataKeyValues, filterProducts, searchProducts, extractExtendedDataFromProduct, fetchCurrentPricesBulk } from '../lib/api';
import { parseImportText, fetchProductsByCardNumbers, matchProductsToImportLines } from '../lib/importUtils';
import { calculateDelta as calculateDeltaUtil } from '../lib/deltaUtils';
import { applyImportExact, getMergedItems } from '../lib/stagingUtils';
import { buildSidebarItems } from '../lib/sidebarUtils';
import NavigationBar from './NavigationBar';
import ProductPreviewModal from './ProductPreviewModal';
import NotificationModal from './NotificationModal';
import ConfirmationModal from './ConfirmationModal';
import ExportDeckModal from './ExportDeckModal';
import DeckNamePromptModal from './DeckNamePromptModal';
import DeckSettingsModal from './DeckSettingsModal';
import PageHeader from './PageHeader';
import ProductListingContent from './ProductListingContent';
import DeckDeltaConfirmation from './DeckDeltaConfirmation';
import SidebarCardList from './SidebarCardList';
import DistributionHistograms from './DistributionHistograms';
import { RiFileCopyFill } from 'react-icons/ri';
import { HiDownload, HiUpload } from 'react-icons/hi';
import './DeckBuilderPage.css';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForNextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const IMAGE_PROXY_BASE = process.env.REACT_APP_IMAGE_PROXY_URL || '/image-proxy';

const DeckBuilderPage = () => {
  const { deckListId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedCurrency, setSelectedCurrency, currencyRates, loadingRates } = useCurrency();
  const { selectedTCGPercentage } = useTCGPercentage();
  const [deckList, setDeckList] = useState(null);
  const [deckItems, setDeckItems] = useState({}); // { product_id: quantity } - current deck items from server
  const [stagedDeckItems, setStagedDeckItems] = useState({}); // { product_id: quantity } - staged changes
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [categoryKeys, setCategoryKeys] = useState([]);
  // Load attribute filters from URL params
  // Uses format: filter_Color=Red&filter_Color=Blue&filter_Rarity=SR
  const loadAttributeFilters = () => {
    const filters = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        const attributeName = key.substring(7); // Remove 'filter_' prefix
        if (!filters[attributeName]) {
          filters[attributeName] = [];
        }
        filters[attributeName].push(value);
      }
    });
    return filters;
  };
  const [attributeFilters, setAttributeFilters] = useState(loadAttributeFilters);
  const [pendingAttributeFilters, setPendingAttributeFilters] = useState({});
  const [attributeValues, setAttributeValues] = useState({});
  const [showAttributeFilters, setShowAttributeFilters] = useState(false);
  const [collapsedAttributeGroups, setCollapsedAttributeGroups] = useState({});
  const [categoryAttributesCache, setCategoryAttributesCache] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  // Load sort state: URL params take priority over localStorage
  // URL format: sort=rarity-asc,level-desc or sort=name-asc (legacy)
  const loadSortState = () => {
    // Check URL params first
    const urlSort = searchParams.get('sort');
    
    if (urlSort) {
      try {
        // Check if it's multi-column format (contains commas)
        if (urlSort.includes(',')) {
          // Multi-column format: rarity-asc,level-desc
          const parts = urlSort.split(',');
          const columns = [];
          const directions = [];
          parts.forEach(part => {
            // Split on last hyphen to handle column names that might contain hyphens
            const lastHyphenIndex = part.lastIndexOf('-');
            if (lastHyphenIndex > 0) {
              const col = part.substring(0, lastHyphenIndex).trim();
              const dir = part.substring(lastHyphenIndex + 1).trim();
              if (col && dir) {
                columns.push(col);
                directions.push(dir);
              }
            }
          });
          return {
            sortOption: 'name-asc', // Not used for multi-column
            sortColumns: columns,
            sortDirections: directions
          };
        } else {
          // Single-column format: name-asc or rarity-asc
          // Split on last hyphen to handle column names that might contain hyphens
          const lastHyphenIndex = urlSort.lastIndexOf('-');
          if (lastHyphenIndex > 0) {
            const col = urlSort.substring(0, lastHyphenIndex).trim();
            const dir = urlSort.substring(lastHyphenIndex + 1).trim();
            if (col && dir && (dir === 'asc' || dir === 'desc')) {
              // New format with explicit direction
              return {
                sortOption: 'name-asc', // Not used for multi-column
                sortColumns: [col],
                sortDirections: [dir]
              };
            }
          }
          // Legacy single-column format: name-asc
          return {
            sortOption: urlSort,
            sortColumns: [],
            sortDirections: []
          };
        }
      } catch (e) {
        console.error('Error parsing sort state from URL:', e);
      }
    }
    
    // Fall back to localStorage
    try {
      const saved = localStorage.getItem('deckBuilderSort');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          sortOption: parsed.sortOption || 'name-asc',
          sortColumns: parsed.sortColumns || [],
          sortDirections: parsed.sortDirections || []
        };
      }
    } catch (e) {
      console.error('Error loading sort state from localStorage:', e);
    }
    return {
      sortOption: 'name-asc',
      sortColumns: [],
      sortDirections: []
    };
  };
  const initialSortState = loadSortState();
  const [sortOption, setSortOption] = useState(initialSortState.sortOption); // Legacy support
  const [sortColumns, setSortColumns] = useState(initialSortState.sortColumns);
  const [sortDirections, setSortDirections] = useState(initialSortState.sortDirections);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState(new Set());
  const [showInDeckOnly, setShowInDeckOnly] = useState(false); // Default to false, will be set to true if deck has cards
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
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDuplicatingDeck, setIsDuplicatingDeck] = useState(false);
  const [showDeltaConfirmation, setShowDeltaConfirmation] = useState(false);
  const [histogramTab, setHistogramTab] = useState('cost'); // 'cost', 'level', 'cardType', 'value'
  const [histogramsMinimized, setHistogramsMinimized] = useState(false);
  const [histogramsExpanded, setHistogramsExpanded] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCapturingGrid, setIsCapturingGrid] = useState(false);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [useProxyImages, setUseProxyImages] = useState(false);
  const [screenshotGridStyles, setScreenshotGridStyles] = useState({ wrapper: null, grid: null });
  // Initialize maxPercentage with user's TCG percentage preference, or default to 100
  const [maxPercentage, setMaxPercentage] = useState(() => {
    const value = selectedTCGPercentage;
    return (value !== null && value !== undefined && !isNaN(value)) ? value : 100;
  });
  const screenshotWrapperWidth = 1400;
  const pendingNavigationRef = useRef(null);
  const getProductNumberValue = useCallback((product) => {
    if (!product) return '';
    const directNumber = product.Number || product.number;
    if (directNumber) {
      return String(directNumber).toUpperCase();
    }
    const productId = String(product.product_id || product.id || '');
    if (!productId) return '';
    const extData = productExtendedData[productId] || [];
    const numberEntry = extData.find((item) => {
      const key = (item.key || item.name || '').toUpperCase();
      return key === 'NUMBER';
    });
    return numberEntry ? String(numberEntry.value || numberEntry.val || '').toUpperCase() : '';
  }, [productExtendedData]);

  const getSortParams = (option) => {
    if (option?.startsWith('number')) {
      return {
        field: 'number',
        order: option.endsWith('desc') ? 'desc' : 'asc'
      };
    }
    if (option?.startsWith('name')) {
      return {
        field: 'name',
        order: option.endsWith('desc') ? 'desc' : 'asc'
      };
    }
    return {
      field: 'product_id',
      order: option?.includes('desc') ? 'desc' : 'asc'
    };
  };

  // Get sort parameters for API (supports both legacy and new multi-column format)
  // Accepts optional override parameters to bypass state (useful when state hasn't updated yet)
  const getAPISortParams = useCallback((overrideColumns = null, overrideDirections = null) => {
    // If override parameters are provided, use them
    if (overrideColumns && overrideColumns.length > 0) {
      return {
        sort_columns: overrideColumns,
        sort_direction: overrideDirections && overrideDirections.length === overrideColumns.length
          ? overrideDirections
          : overrideColumns.map(() => 'asc')
      };
    }
    // If multi-column sort is active, use it
    if (sortColumns && sortColumns.length > 0) {
      return {
        sort_columns: sortColumns,
        sort_direction: sortDirections.length === sortColumns.length 
          ? sortDirections 
          : sortColumns.map(() => 'asc')
      };
    }
    // Otherwise, fall back to legacy single-column sort
    const { field, order } = getSortParams(sortOption);
    return {
      sort_by: field,
      sort_order: order
    };
  }, [sortColumns, sortDirections, sortOption]);

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
  const isUpdatingFiltersFromUrlRef = useRef(false);
  const isUpdatingSortFromUrlRef = useRef(false);
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
  const productsGridRef = useRef(null);
  const screenshotModeRef = useRef(false);

  useEffect(() => {
    screenshotModeRef.current = screenshotMode;
    if (typeof document === 'undefined') return;
    if (screenshotMode) {
      document.body.classList.add('disable-card-animations');
    } else {
      document.body.classList.remove('disable-card-animations');
    }
    return () => {
      document.body.classList.remove('disable-card-animations');
    };
  }, [screenshotMode]);
  
  // Determine permissions
  const isOwner = !!(user && deckList && deckList.user_id === user.id);
  const canEdit = isOwner;

  // Sync maxPercentage with user's TCG percentage preference
  useEffect(() => {
    if (selectedTCGPercentage !== null && selectedTCGPercentage !== undefined && !isNaN(selectedTCGPercentage)) {
      setMaxPercentage(selectedTCGPercentage);
    } else {
      setMaxPercentage(100);
    }
  }, [selectedTCGPercentage]);

  // Save sort state to localStorage and URL whenever it changes
  // URL format: sort=rarity:asc,level:desc or sort=name-asc (legacy)
  useEffect(() => {
    // Skip if we're updating from URL to prevent infinite loop
    if (isUpdatingSortFromUrlRef.current) {
      return;
    }
    
    try {
      // Save to localStorage
      localStorage.setItem('deckBuilderSort', JSON.stringify({
        sortOption,
        sortColumns,
        sortDirections
      }));
      
      // Update URL params
      const newSearchParams = new URLSearchParams(searchParams);
      
      // Remove old format params if they exist
      newSearchParams.delete('sortOption');
      newSearchParams.delete('sortColumns');
      newSearchParams.delete('sortDirections');
      
      // Build the sort string
      let sortStr = null;
      if (sortColumns && sortColumns.length > 0) {
        // Multi-column format: rarity-asc,level-desc
        const sortParts = sortColumns.map((col, idx) => {
          const dir = (sortDirections && sortDirections[idx]) || 'asc';
          return `${col}-${dir}`;
        });
        sortStr = sortParts.join(',');
      } else if (sortOption && sortOption !== 'name-asc') {
        // Legacy single-column format: name-asc
        sortStr = sortOption;
      }
      
      // Only update if different from current URL
      const currentSort = searchParams.get('sort');
      if (sortStr !== currentSort) {
        if (sortStr) {
          newSearchParams.set('sort', sortStr);
        } else {
          newSearchParams.delete('sort');
        }
        setSearchParams(newSearchParams, { replace: true });
      }
    } catch (e) {
      console.error('Error saving sort state:', e);
    }
  }, [sortOption, sortColumns, sortDirections, searchParams, setSearchParams]);

  // Sync sort state from URL params when they change (but don't trigger save)
  useEffect(() => {
    const urlSort = searchParams.get('sort');
    
    // Only update if URL param exists
    if (urlSort) {
      try {
        let urlSortOption = 'name-asc';
        let urlColumns = [];
        let urlDirections = [];
        
        // Check if it's multi-column format (contains commas)
        if (urlSort.includes(',')) {
          // Multi-column format: rarity-asc,level-desc
          const parts = urlSort.split(',');
          parts.forEach(part => {
            // Split on last hyphen to handle column names that might contain hyphens
            const lastHyphenIndex = part.lastIndexOf('-');
            if (lastHyphenIndex > 0) {
              const col = part.substring(0, lastHyphenIndex).trim();
              const dir = part.substring(lastHyphenIndex + 1).trim();
              if (col && dir) {
                urlColumns.push(col);
                urlDirections.push(dir);
              }
            }
          });
        } else {
          // Single-column format: name-asc or rarity-asc
          // Split on last hyphen to handle column names that might contain hyphens
          const lastHyphenIndex = urlSort.lastIndexOf('-');
          if (lastHyphenIndex > 0) {
            const col = urlSort.substring(0, lastHyphenIndex).trim();
            const dir = urlSort.substring(lastHyphenIndex + 1).trim();
            if (col && dir && (dir === 'asc' || dir === 'desc')) {
              // New format with explicit direction
              urlColumns = [col];
              urlDirections = [dir];
            } else {
              // Legacy single-column format: name-asc
              urlSortOption = urlSort;
            }
          } else {
            // Legacy single-column format: name-asc
            urlSortOption = urlSort;
          }
        }
        
        // Always update from URL (URL is source of truth)
        isUpdatingSortFromUrlRef.current = true;
        setSortOption(urlSortOption);
        setSortColumns(urlColumns);
        setSortDirections(urlDirections);
        // Reset flag after state update
        setTimeout(() => {
          isUpdatingSortFromUrlRef.current = false;
        }, 0);
      } catch (e) {
        console.error('Error parsing sort state from URL:', e);
      }
    }
    // If no sort in URL, don't change state (keep current or default)
  }, [searchParams]); // Only depend on searchParams to avoid loops

  // Sync attribute filters from URL params when they change
  useEffect(() => {
    const urlFilters = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        const attributeName = key.substring(7); // Remove 'filter_' prefix
        if (!urlFilters[attributeName]) {
          urlFilters[attributeName] = [];
        }
        urlFilters[attributeName].push(value);
      }
    });
    
    // Only update if different from current state
    const currentFiltersStr = JSON.stringify(attributeFilters);
    const urlFiltersStr = JSON.stringify(urlFilters);
    if (currentFiltersStr !== urlFiltersStr) {
      isUpdatingFiltersFromUrlRef.current = true;
      setAttributeFilters(urlFilters);
      // Reset flag after state update
      setTimeout(() => {
        isUpdatingFiltersFromUrlRef.current = false;
      }, 0);
    }
  }, [searchParams]); // Only depend on searchParams to avoid loops

  // Update URL params when attribute filters change (but don't save to localStorage)
  // Uses format: filter_Color=Red&filter_Color=Blue&filter_Rarity=SR
  useEffect(() => {
    // Skip if we're updating from URL to prevent infinite loop
    if (isUpdatingFiltersFromUrlRef.current) {
      return;
    }
    
    const newSearchParams = new URLSearchParams(searchParams);
    
    // Remove all existing filter_ params
    const keysToRemove = [];
    newSearchParams.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(key => newSearchParams.delete(key));
    
    // Add current filters as separate params
    if (attributeFilters && Object.keys(attributeFilters).length > 0) {
      Object.keys(attributeFilters).forEach(key => {
        const values = attributeFilters[key];
        if (Array.isArray(values) && values.length > 0) {
          values.forEach(value => {
            newSearchParams.append(`filter_${key}`, value);
          });
        } else if (values && !Array.isArray(values)) {
          newSearchParams.append(`filter_${key}`, values);
        }
      });
    }
    
    // Only update if URL actually changed
    const currentUrlFilters = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        const attributeName = key.substring(7);
        if (!currentUrlFilters[attributeName]) {
          currentUrlFilters[attributeName] = [];
        }
        currentUrlFilters[attributeName].push(value);
      }
    });
    
    const newUrlFilters = {};
    newSearchParams.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        const attributeName = key.substring(7);
        if (!newUrlFilters[attributeName]) {
          newUrlFilters[attributeName] = [];
        }
        newUrlFilters[attributeName].push(value);
      }
    });
    
    if (JSON.stringify(currentUrlFilters) !== JSON.stringify(newUrlFilters)) {
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [attributeFilters, searchParams, setSearchParams]);

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
      
      // Load products with current filters (initial load) only in edit mode
      if (canEdit && !loadingProductsRef.current) {
        const initialFilterParams = JSON.stringify({
          group_ids: JSON.stringify(selectedGroupIds || []),
          filters: attributeFilters,
          sortOption: sortOption,
          sortColumns: sortColumns || [],
          sortDirections: sortDirections || []
        });
        lastFilterParamsRef.current = initialFilterParams;
        setCurrentPage(1);
        loadProducts(1, false);
      } else if (!canEdit) {
        setHasMorePages(false);
      }
    }
  }, [deckList?.category_id, canEdit]); // Only depend on category_id and editability

  useEffect(() => {
    if (!deckList || !deckList.category_id) return;
    
    // Skip initial load (handled by category change effect)
    if (lastCategoryIdRef.current !== deckList.category_id) return;
    
    // Only reload products when filters actually change
    const currentFilterParams = JSON.stringify({
      group_ids: JSON.stringify(selectedGroupIds || []),
      filters: attributeFilters,
      sortOption: sortOption,
      sortColumns: sortColumns || [],
      sortDirections: sortDirections || []
    });
    
    if (canEdit && currentFilterParams !== lastFilterParamsRef.current && !loadingProductsRef.current) {
      lastFilterParamsRef.current = currentFilterParams;
      setCurrentPage(1);
      loadProducts(1, false);
    } else if (!canEdit) {
      setHasMorePages(false);
    }
  }, [selectedGroupIds, attributeFilters, sortOption, deckList?.category_id, canEdit]);

  // Extract extended data from products (now included in product objects)
  // Defined before loadDeckProductsForIds that uses it
  const loadProductExtendedData = useCallback((products) => {
    const extendedDataMap = {};
    
    products.forEach(product => {
      const productId = String(product.product_id || product.id);
      const extendedData = extractExtendedDataFromProduct(product);
      if (Array.isArray(extendedData) && extendedData.length > 0) {
        extendedDataMap[productId] = extendedData;
      }
    });
    
    setProductExtendedData(prev => ({ ...prev, ...extendedDataMap }));
  }, []);

  // Load deck products function - defined before useEffect that uses it
  const loadDeckProductsForIds = useCallback(async (productIds) => {
    if (productIds.length === 0) {
      setDeckProducts([]);
      return;
    }
    if (loadingDeckProductsRef.current) return;
    if (!deckList || !deckList.category_id) return;

    try {
      loadingDeckProductsRef.current = true;
      // Get current sort parameters to preserve sort order
      const apiSortParams = getAPISortParams();
      
      // Fetch in batches of 1000 using filterProducts
      const batches = [];
      for (let i = 0; i < productIds.length; i += 1000) {
        batches.push(productIds.slice(i, i + 1000));
      }
      
      const allProducts = [];
      for (const batch of batches) {
        const filterParams = {
          category_id: deckList.category_id,
          product_ids: batch,
          ...apiSortParams, // Include sort parameters to preserve API sort order
          page: 1,
          limit: 1000
        };
        const response = await filterProducts(filterParams);
        let batchProducts = [];
        if (response && typeof response === 'object') {
          if (response.data && Array.isArray(response.data)) {
            batchProducts = response.data;
          } else if (response.products && Array.isArray(response.products)) {
            batchProducts = response.products;
          } else if (response.results && Array.isArray(response.results)) {
            batchProducts = response.results;
          } else if (Array.isArray(response)) {
            batchProducts = response;
          }
        }
        allProducts.push(...batchProducts);
      }
      
      setDeckProducts(allProducts);
      // Extract extended data from products (now included in product objects)
      loadProductExtendedData(allProducts);
      
      // Fetch prices for all deck products and merge with existing prices
      if (allProducts.length > 0) {
        const productIdsForPrices = allProducts
          .map(p => p.product_id || p.id)
          .filter(id => id !== undefined && id !== null);
        
        if (productIdsForPrices.length > 0) {
          try {
            const prices = await fetchCurrentPricesBulk(productIdsForPrices);
            setProductPrices(prev => ({ ...prev, ...prices }));
          } catch (err) {
            console.error('Error loading prices for deck products:', err);
          }
        }
      }
    } catch (err) {
      console.error('Error loading deck products:', err);
      setDeckProducts([]);
    } finally {
      loadingDeckProductsRef.current = false;
    }
  }, [deckList, getAPISortParams, loadProductExtendedData]);

  useEffect(() => {
    // Load deck products whenever deck items change (including staged changes) or sort parameters change
    // But debounce to avoid excessive API calls when rapidly adding/removing cards
    if (loadingDeckProductsRef.current) return;
    
    const mergedItems = { ...deckItems, ...stagedDeckItems };
    const productIds = Object.keys(mergedItems)
      .filter(id => mergedItems[id] > 0)
      .map(id => parseInt(id))
      .filter(id => !isNaN(id))
      .sort((a, b) => a - b); // Sort for consistent comparison
    
    const productIdsKey = productIds.join(',');
    // Also track sort parameters to reload when sort changes
    const sortKey = JSON.stringify({ 
      sortColumns: sortColumns || [], 
      sortDirections: sortDirections || [],
      sortOption 
    });
    const combinedKey = `${productIdsKey}|${sortKey}`;
    
    // Reload if product IDs changed OR sort parameters changed
    if (combinedKey !== lastProductIdsRef.current) {
      lastProductIdsRef.current = combinedKey;
      isUpdatingDeckProductsRef.current = true;
      
      // Debounce the API call slightly to batch rapid changes
      const timeoutId = setTimeout(async () => {
        if (productIds.length > 0) {
          // Load deck products with current sort parameters to preserve sort order
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
  }, [deckItems, stagedDeckItems, sortColumns, sortDirections, sortOption, loadDeckProductsForIds]);

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

    // Search filter (client-side) - only apply if we didn't use the search endpoint
    // When using the search endpoint, the API already handles search filtering (including special character normalization)
    // So we skip client-side search filtering to avoid double-filtering
    // Note: We check if searchQuery exists AND we're not filtering to deck (which uses deckProducts loaded by ID)
    // Since loadProducts uses searchProducts when searchQuery is present and not filtering to deck, we skip client-side filtering
    const usedSearchEndpoint = searchQuery && searchQuery.trim() && !shouldFilterToDeck && !showFavoritesOnly && !showOwnedOnly && !showInDeckOnly;
    
    if (searchQuery.trim() && !usedSearchEndpoint) {
      // Only apply client-side search filtering when NOT using the search endpoint
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

    // Sort - only apply client-side sorting if:
    // 1. NOT using multi-column API sort (API already sorted those)
    // 2. AND there's an explicit sort applied (not the default name-asc)
    // When no sort is applied, preserve the API order to avoid reordering as new products load
    if ((!sortColumns || sortColumns.length === 0) && sortOption && sortOption !== 'name-asc') {
      // Legacy single-column client-side sorting (only when explicit sort is applied)
      filtered.sort((a, b) => {
        if (sortOption === 'name-asc' || sortOption === 'name-desc') {
          const aName = (a.name || '').toLowerCase();
          const bName = (b.name || '').toLowerCase();
          return sortOption === 'name-desc'
            ? bName.localeCompare(aName)
            : aName.localeCompare(bName);
        }
        if (sortOption === 'number-asc' || sortOption === 'number-desc') {
          const aNum = getProductNumberValue(a);
          const bNum = getProductNumberValue(b);
          if (!aNum && !bNum) return 0;
          if (!aNum) return sortOption === 'number-asc' ? 1 : -1;
          if (!bNum) return sortOption === 'number-asc' ? -1 : 1;
          return sortOption === 'number-desc'
            ? bNum.localeCompare(aNum, undefined, { numeric: true, sensitivity: 'base' })
            : aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' });
        }
        return 0;
      });
    }
    // If using multi-column sort or default sort, products are already sorted by the API, so we preserve that order

    setFilteredProducts(filtered);
    
    // Only reset displayedCount if filter parameters actually changed
    // Don't reset when deckItems/stagedDeckItems change (to preserve scroll position)
    // Don't include productsLength/deckProductsLength in comparison - it changes when search returns no results
    // which would cause infinite loops
    const currentFilterState = {
      searchQuery,
      showFavoritesOnly,
      showInDeckOnly,
      showOwnedOnly,
      shouldFilterToDeck,
      sortOption,
      sortColumns: JSON.stringify(sortColumns || []),
      sortDirections: JSON.stringify(sortDirections || []),
      attributeFilters: JSON.stringify(attributeFilters) // Stringify for comparison
    };
    
    const prevState = prevFilterStateRef.current || {};
    
    // Only reset if:
    // 1. Search query changed
    // 2. Favorites filter toggled
    // 3. In-deck filter toggled
    // 4. Owned filter toggled
    // 5. Sort option changed
    // 6. Attribute filters changed
    // 7. Source switched between products and deckProducts (shouldFilterToDeck changed)
    // Note: We don't reset when products/deckProducts length changes - this prevents infinite loops
    // when search returns no results (products.length becomes 0, which would trigger reset again)
    const shouldReset = 
      currentFilterState.searchQuery !== (prevState.searchQuery || '') ||
      currentFilterState.showFavoritesOnly !== (prevState.showFavoritesOnly || false) ||
      currentFilterState.showInDeckOnly !== (prevState.showInDeckOnly || false) ||
      currentFilterState.showOwnedOnly !== (prevState.showOwnedOnly || false) ||
      currentFilterState.sortOption !== (prevState.sortOption || 'name-asc') ||
      currentFilterState.sortColumns !== (prevState.sortColumns || '[]') ||
      currentFilterState.sortDirections !== (prevState.sortDirections || '[]') ||
      currentFilterState.attributeFilters !== (prevState.attributeFilters || '{}') ||
      currentFilterState.shouldFilterToDeck !== (prevState.shouldFilterToDeck || false);
    
    // Only reset if we're not already loading and the filter actually changed
    if (shouldReset && !loadingProductsRef.current && !loading) {
      setCurrentPage(1);
      if (canEdit) {
        loadProducts(1, false);
      } else {
        setHasMorePages(false);
      }
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
  }, [products, deckProducts, searchQuery, showFavoritesOnly, showInDeckOnly, showOwnedOnly, favorites, inventory, deckItems, stagedDeckItems, sortOption, user, deckList, canEdit]);


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

      // Check if deck is private and user is not the owner
      if (deck.private) {
        const deckUserId = deck.user_id || deck.userId;
        const currentUserId = user?.id;
        
        if (!currentUserId || deckUserId !== currentUserId) {
          setError('This deck is private and you do not have permission to view it');
          setDeckList(null);
          return;
        }
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
      
      // Set "In Deck" filter default: only enable if deck has cards
      // This reduces clicks for new empty decks (user sees all cards immediately)
      const hasCards = Object.values(itemsMap).some(quantity => quantity > 0);
      setShowInDeckOnly(hasCards);
      
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

  const loadProducts = async (page = 1, append = false, overrideSortColumns = null, overrideSortDirections = null) => {
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
          filters: attributeFilters, // Include attribute filters in search
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
        
        // If we got no results from search, explicitly set hasMore to false to stop retrying
        if (productsData.length === 0) {
          hasMore = false;
        }
        
        // Filter by category if needed (search may return products from all categories)
        if (deckList.category_id && productsData.length > 0) {
          const categoryIdInt = deckList.category_id;
          productsData = productsData.filter(p => {
            const productCategoryId = p.category_id || p.categoryId;
            return productCategoryId === categoryIdInt;
          });
          total = productsData.length;
          // After category filtering, if no products remain, set hasMore to false
          if (productsData.length === 0) {
            hasMore = false;
          }
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
          // Fetch all products at once using filter endpoint with product_ids
          const productIdsArray = Array.from(productIds);
          const apiSortParams = getAPISortParams(overrideSortColumns, overrideSortDirections);
          const filterParams = {
            category_id: deckList.category_id,
            product_ids: productIdsArray,
            ...apiSortParams,
            page: 1,
            limit: 1000 // Use max limit to get all products at once
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
            
            // Extract pagination info
            total = response.total !== null && response.total !== undefined ? response.total : productsData.length;
            pageNum = 1;
            hasMore = false; // We loaded everything, no more pages
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
        const apiSortParams = getAPISortParams(overrideSortColumns, overrideSortDirections);
        const filterParams = {
          category_id: deckList.category_id,
          group_id: selectedGroupIds && selectedGroupIds.length > 0 ? selectedGroupIds : undefined,
          filters: attributeFilters,
          ...apiSortParams,
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
        
        // If we got no results, explicitly set hasMore to false to stop retrying
        if (productsData.length === 0) {
          hasMore = false;
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
          // If we got no new products from this append, there are no more pages
          const calculatedHasMore = newProducts.length === 0 ? false : (total > 0 ? itemsLoaded < total : hasMore);
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
        // If we got no results, set hasMorePages to false FIRST to prevent observer from triggering
        const itemsLoaded = productsData.length;
        const calculatedHasMore = productsData.length === 0 ? false : (total > 0 ? itemsLoaded < total : hasMore);
        // Set hasMorePages FIRST to prevent IntersectionObserver from triggering
        setHasMorePages(calculatedHasMore);
        // Then set products (which will trigger filterAndSortProducts)
        setProducts(productsData);
        // If no results, also immediately set filteredProducts to empty to prevent observer setup
        if (productsData.length === 0) {
          setFilteredProducts([]);
        }
        
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
    if (!canEdit) return;
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

  const handleOpenDuplicateModal = () => {
    if (!user) {
      setNotification({
        isOpen: true,
        title: 'Sign In Required',
        message: 'Log in to duplicate this deck.',
        type: 'error'
      });
      return;
    }
    if (!deckList) {
      setNotification({
        isOpen: true,
        title: 'Duplicate Unavailable',
        message: 'Deck data is still loading. Please wait a moment.',
        type: 'error'
      });
      return;
    }
    setShowDuplicateModal(true);
  };

  const handleConfirmDuplicateDeck = async (newDeckName) => {
    if (!user || !deckList || !deckList.category_id) {
      setNotification({
        isOpen: true,
        title: 'Duplicate Failed',
        message: 'Unable to duplicate deck at this time.',
        type: 'error'
      });
      return;
    }
    if (isDuplicatingDeck) return;

    setIsDuplicatingDeck(true);
    try {
      const sourceDeckId = deckList.deck_list_id || deckList.id;
      const fullDeck = await fetchDeckList(sourceDeckId, user.id);

      if (!fullDeck) {
        throw new Error('Deck data could not be loaded.');
      }

      const itemsToCopy = fullDeck.items || {};
      // Preserve metadata fields when duplicating deck
      const metadataOptions = {
        color_1: fullDeck.color_1,
        color_2: fullDeck.color_2,
        strategy: fullDeck.strategy,
        selling: fullDeck.selling,
        buying: fullDeck.buying,
        private: fullDeck.private
      };
      const newDeck = await createDeckList(
        user.id,
        deckList.category_id,
        newDeckName,
        itemsToCopy,
        metadataOptions
      );
      const newDeckId = newDeck.deck_list_id || newDeck.id;

      if (newDeckId && Object.keys(itemsToCopy).length > 0) {
        // Preserve existing metadata fields when copying items to new deck
        const metadataOptions = fullDeck ? {
          color_1: fullDeck.color_1,
          color_2: fullDeck.color_2,
          strategy: fullDeck.strategy,
          selling: fullDeck.selling,
          buying: fullDeck.buying,
          private: fullDeck.private
        } : {};
        await updateDeckListItems(newDeckId, user.id, itemsToCopy, metadataOptions);
      }

      setNotification({
        isOpen: true,
        title: 'Deck Duplicated',
        message: `Deck "${newDeckName}" has been duplicated successfully.`,
        type: 'success'
      });

      navigate(`/deck-builder/${newDeckId}`);
    } catch (err) {
      console.error('[handleConfirmDuplicateDeck] Error duplicating deck:', err);
      setNotification({
        isOpen: true,
        title: 'Duplicate Failed',
        message: err?.message || 'Failed to duplicate deck. Please try again.',
        type: 'error'
      });
    } finally {
      setIsDuplicatingDeck(false);
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

  // Extract unique colors from deck items with card counts
  const extractDeckColors = (items) => {
    const colorCounts = {}; // { color: count }
    
    // Iterate through all products in the deck
    Object.keys(items).forEach(productId => {
      const quantity = items[productId];
      if (quantity <= 0) return; // Skip items with 0 or negative quantity
      
      // Get extended data for this product
      const extData = productExtendedData[String(productId)] || [];
      
      // Extract all color values from extended data and count cards
      extData.forEach(item => {
        const key = item.key || item.name;
        const value = item.value || item.val;
        
        // Check if this is a color attribute
        if (key && value && key.toUpperCase() === 'COLOR') {
          // Add the quantity to this color's count
          if (!colorCounts[value]) {
            colorCounts[value] = 0;
          }
          colorCounts[value] += quantity;
        }
      });
    });
    
    // Convert to array of [color, count] pairs and sort by count (descending), then by color name
    const colorArray = Object.entries(colorCounts)
      .sort((a, b) => {
        // Sort by count descending, then by color name ascending
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
      });
    
    // Format as {color}-{amount} and return up to 2 colors
    return {
      color_1: colorArray.length > 0 ? `${colorArray[0][0]}-${colorArray[0][1]}` : null,
      color_2: colorArray.length > 1 ? `${colorArray[1][0]}-${colorArray[1][1]}` : null
    };
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

      // Extract unique colors from the merged deck items
      const deckColors = extractDeckColors(mergedItems);

      // Prepare metadata options with updated colors
      const metadataOptions = {
        color_1: deckColors.color_1,
        color_2: deckColors.color_2,
        // Preserve other metadata fields
        strategy: deckList?.strategy,
        selling: deckList?.selling,
        buying: deckList?.buying,
        private: deckList?.private
      };

      // Perform updates (if any items to update)
      if (Object.keys(itemsToUpdate).length > 0) {
        await updateDeckListItems(deckListId, user.id, itemsToUpdate, metadataOptions);
      }

      // Perform deletes (if any items to delete)
      // If we only have deletes and no updates, we still need to update colors
      if (itemsToDelete.length > 0) {
        if (Object.keys(itemsToUpdate).length === 0) {
          // Only deletes, no updates - update colors via a minimal update
          // Send empty items object but with metadata to update colors
          await updateDeckListItems(deckListId, user.id, {}, metadataOptions);
        }
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

  const handleDeckSettingsSave = async (settings) => {
    if (!user || !deckListId) return;

    try {
      setIsSavingSettings(true);
      
      // Preserve existing metadata fields when updating settings
      const metadataOptions = {
        color_1: deckList?.color_1,
        color_2: deckList?.color_2,
        strategy: settings.strategy,
        selling: settings.selling,
        buying: settings.buying,
        private: settings.private
      };
      
      await updateDeckListName(deckListId, user.id, settings.name || deckList?.name || '', metadataOptions);
      
      // Optimistically update the deckList state immediately
      if (deckList) {
        setDeckList({
          ...deckList,
          name: settings.name || deckList.name,
          ...settings
        });
      }
      
      // Update deckName state if name was changed
      if (settings.name) {
        setDeckName(settings.name);
      }
      
      // Reload deck to sync with server (in background)
      loadingDeckListRef.current = false; // Reset guard to allow reload
      await loadDeckList();
      
      setShowSettingsModal(false);
      setNotification({
        isOpen: true,
        title: 'Success',
        message: 'Deck settings updated successfully.',
        type: 'success'
      });
    } catch (err) {
      console.error('Error updating deck settings:', err);
      setNotification({
        isOpen: true,
        title: 'Error',
        message: 'Failed to update deck settings. Please try again.',
        type: 'error'
      });
    } finally {
      setIsSavingSettings(false);
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
    if (canEdit) {
      loadProducts(1, false);
    } else {
      setHasMorePages(false);
    }
  };

  const waitForGridReady = async (timeout = 6000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const grid = productsGridRef.current;
      if (grid) {
        const cards = grid.querySelectorAll('.product-card');
        const animatingCard = screenshotModeRef.current ? null : grid.querySelector('.product-card-new');
        if (cards.length > 0 && !animatingCard) {
          return grid;
        }
      }
      await wait(100);
    }
    throw new Error('Timed out waiting for products grid to finish loading.');
  };

  const waitForImagesToLoad = async (gridElement, timeoutPerImage = 5000) => {
    if (!gridElement) return;
    const images = Array.from(gridElement.querySelectorAll('.product-image'))
      .filter((img) => img.offsetParent !== null && img.style.display !== 'none');
    const pending = images.filter(
      (img) => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0
    );
    if (pending.length === 0) return;

    await Promise.all(
      pending.map(
        (img) =>
          new Promise((resolve) => {
            const cleanup = () => {
              img.removeEventListener('load', onLoad);
              img.removeEventListener('error', onDone);
              clearTimeout(timer);
              resolve();
            };
            const onLoad = () => cleanup();
            const onDone = () => cleanup();
            const timer = setTimeout(cleanup, timeoutPerImage);
            if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
              cleanup();
              return;
            }
            img.addEventListener('load', onLoad, { once: true });
            img.addEventListener('error', onDone, { once: true });
          })
      )
    );
  };

  const toggleAttributeGroup = (key) => {
    setCollapsedAttributeGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getProxyImageSrc = useCallback((product) => {
    const raw = product?.image_url || product?.imageUrl;
    if (!raw) return raw;
    return `${IMAGE_PROXY_BASE}?url=${encodeURIComponent(raw)}`;
  }, []);

  const handleDownloadGridScreenshot = async () => {
    if (isCapturingGrid) return;

    if (!deckProducts || deckProducts.length === 0) {
      setNotification({
        isOpen: true,
        title: 'No Cards to Capture',
        message: 'Add cards to the deck before capturing the products grid.',
        type: 'error'
      });
      return;
    }

    setIsCapturingGrid(true);

    try {
      setUseProxyImages(true);
      setScreenshotMode(true);
      const cardCount = Math.max(filteredProducts.length, deckProducts.length, 1);
      const columns = Math.max(1, Math.round(Math.sqrt(cardCount)));
      const gap = 20;
      setScreenshotGridStyles({
        wrapper: {
          padding: '32px 32px 72px',
          backgroundColor: '#D7DFEB',
          backgroundImage: 'var(--deck-screenshot-bg, var(--app-bg-logo))',
          backgroundBlendMode: 'normal',
          borderRadius: '16px',
          margin: '0 auto',
          width: `${screenshotWrapperWidth}px`,
          maxWidth: `${screenshotWrapperWidth}px`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'bottom right',
          backgroundSize: '45%',
        },
        grid: {
          gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`,
          gap: `${gap}px`,
          justifyContent: 'center',
          width: '100%',
          maxWidth: `${screenshotWrapperWidth - 64}px`,
        }
      });
      if (!showInDeckOnly) {
        setShowInDeckOnly(true);
      }
      await waitForNextPaint();
      await wait(200);
      const gridElement = await waitForGridReady();
      await waitForImagesToLoad(gridElement);

      const canvas = await html2canvas(gridElement, {
        backgroundColor: window.getComputedStyle(document.body).backgroundColor || '#ffffff',
        useCORS: true,
        scale: Math.min(2, window.devicePixelRatio || 2),
        logging: false,
        allowTaint: true,
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((canvasBlob) => {
          if (canvasBlob) {
            resolve(canvasBlob);
          } else {
            reject(new Error('Unable to generate image blob'));
          }
        }, 'image/png');
      });

      const safeDeckName = (deckList?.name || 'deck')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'deck';
      const fileName = `${safeDeckName}-products.png`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[handleDownloadGridScreenshot] Error capturing grid:', err);
      setNotification({
        isOpen: true,
        title: 'Screenshot Failed',
        message: 'Unable to capture the products grid. Please ensure the cards are visible and try again.',
        type: 'error'
      });
    } finally {
      setUseProxyImages(false);
      setScreenshotMode(false);
      setScreenshotGridStyles({ wrapper: null, grid: null });
      setIsCapturingGrid(false);
    }
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

  if (loading && !deckList) {
    return (
      <div className={`deck-builder-page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading deck...</p>
        </div>
      </div>
    );
  }

  if (error || !deckList) {
    return (
      <div className={`deck-builder-page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
    <div className={`deck-builder-page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
              <div className="sidebar-header-actions">
                {user && (
                  <button
                    className="sidebar-duplicate-button"
                    onClick={handleOpenDuplicateModal}
                    title="Duplicate this deck"
                    disabled={isDuplicatingDeck}
                  >
                    <RiFileCopyFill />
                  </button>
                )}
                <button
                  className="sidebar-export-button"
                  onClick={() => setShowExportModal(true)}
                  title="Export deck list"
                >
                  <HiUpload />
                </button>
                <button
                  className="sidebar-download-button"
                  onClick={handleDownloadGridScreenshot}
                  title="Download deck grid screenshot"
                  disabled={isCapturingGrid || (deckProducts?.length || 0) === 0}
                >
                  <HiDownload />
                </button>
              </div>
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
              titleActions={
                canEdit && (
                  <button
                    className="settings-icon-button"
                    onClick={() => setShowSettingsModal(true)}
                    title="Deck settings"
                  >
                    ⚙️
                  </button>
                )
              }
              meta={
                deckList && (
                  <div className="page-header-tags">
                    {deckList.strategy && (
                      <span className="page-header-tag">{deckList.strategy}</span>
                    )}
                    <span className="page-header-tag">
                      {deckList.private ? 'Private' : 'Public'}
                    </span>
                    <span className="page-header-tag">
                      {deckList.selling ? 'WTS' : deckList.buying ? 'WTB' : 'Play'}
                    </span>
                  </div>
                )
              }
              actions={
                <div className="deck-builder-header-actions">
                  {user && (
                    <button
                      className="import-export-button-header duplicate-deck-button"
                      onClick={handleOpenDuplicateModal}
                      title="Duplicate this deck"
                      disabled={isDuplicatingDeck}
                    >
                      <RiFileCopyFill />
                      <span>{isDuplicatingDeck ? 'Duplicating...' : 'Duplicate'}</span>
                    </button>
                  )}
                  <button 
                    className="import-export-button-header" 
                    onClick={() => setShowExportModal(true)}
                    title="Export or import deck list"
                  >
                    <HiUpload />
                    <span>Import</span>
                  </button>
                  <button
                    className="import-export-button-header download-grid-button"
                    onClick={handleDownloadGridScreenshot}
                    title="Download a screenshot of cards currently in the deck"
                    disabled={isCapturingGrid || loading || (deckProducts?.length || 0) === 0}
                  >
                    <HiDownload />
                    <span>{isCapturingGrid ? 'Preparing...' : 'Screenshot'}</span>
                  </button>
                </div>
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
              sortColumns={sortColumns}
              setSortColumns={setSortColumns}
              sortDirections={sortDirections}
              setSortDirections={setSortDirections}
              showFavoritesOnly={showFavoritesOnly}
              setShowFavoritesOnly={setShowFavoritesOnly}
              showOwnedOnly={showOwnedOnly}
              setShowOwnedOnly={setShowOwnedOnly}
              showInDeckOnly={showInDeckOnly}
              setShowInDeckOnly={setShowInDeckOnly}
              selectedGroupIds={selectedGroupIds}
              setSelectedGroupIds={setSelectedGroupIds}
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
              loadingMore={canEdit ? loadingMore : false}
              error={error}
              currentPage={currentPage}
              totalCount={totalCount}
              hasMorePages={canEdit ? hasMorePages : false}
              onLoadMore={canEdit ? loadMoreProducts : undefined}
              newlyAddedProductIds={newlyAddedProductIds}
              onRefresh={canEdit ? () => {
                setCurrentPage(1);
                loadProducts(1, false);
              } : undefined}
              
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
              handleAttributeFilter={handleAttributeFilter}
              handleApplyAttributeFilters={handleApplyAttributeFilters}
              handleClearPendingFilters={handleClearPendingFilters}
              toggleAttributeGroup={toggleAttributeGroup}
              onSortApply={(columns, directions) => {
                // Explicitly reload products when sort is applied
                // Pass sort parameters directly to bypass state that hasn't updated yet
                setCurrentPage(1);
                loadProducts(1, false, columns, directions);
              }}
              
              // Custom render props
              renderProductCardActions={(product, productId, productIdStr, quantity, isFavorited) => {
                if (screenshotMode || (!user && !canEdit)) return null;
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
              productsGridRef={productsGridRef}
              productsGridStyle={screenshotGridStyles.grid}
              productsGridWrapperStyle={screenshotGridStyles.wrapper}
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
              getProductImageSrc={useProxyImages ? getProxyImageSrc : undefined}
              renderWatermark={
                screenshotMode
                  ? () => (
                      <>
                        <div className="screenshot-watermark-left">
                          <img
                            src={`${process.env.PUBLIC_URL || ''}/logo-2.png`}
                            alt="StrikerPack"
                            className="screenshot-watermark-logo"
                          />
                          <span>{`${typeof window !== 'undefined' ? window.location.origin : ''}/deck-builder/${deckListId}`}</span>
                        </div>
                        <div className="screenshot-watermark-right">
                          <span className="screenshot-watermark-deck-name">{deckList?.name || 'Untitled Deck'}</span>
                          {(() => {
                            const ownerUsername =
                              deckList?.user_username ||
                              deckList?.username ||
                              deckList?.user?.username ||
                              deckList?.owner_username ||
                              user?.username;
                            return ownerUsername ? <span className="screenshot-watermark-username">@{ownerUsername}</span> : null;
                          })()}
                        </div>
                      </>
                    )
                  : null
              }
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

      <DeckNamePromptModal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        onConfirm={handleConfirmDuplicateDeck}
        title="Duplicate Deck"
        message="Enter a name for the duplicated deck:"
        defaultValue={deckList ? `Copy of ${deckList.name || 'Untitled Deck'}` : ''}
      />

      <DeckSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSave={handleDeckSettingsSave}
        deckList={deckList}
        isSaving={isSavingSettings}
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

