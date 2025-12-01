// API service for communicating with the backend
import { getAuthHeaders as getSupabaseAuthHeaders } from './supabase';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

/**
 * Get headers with authentication token if available
 * Uses Supabase auth client for session management
 * @returns {Promise<Object>} Headers object with Content-Type and optional Authorization
 */
const getAuthHeaders = async () => {
  return await getSupabaseAuthHeaders();
};

/**
 * Filter products by various criteria
 * @param {Object} params - Filter parameters object
 * @param {number} params.category_id - Category ID (required, must be an integer)
 * @param {Object} params.filters - Filter object with attribute keys and array values
 * @param {number} [params.group_id] - Optional group ID
 * @param {string} [params.sort_by] - Sort field (e.g., 'name', 'product_id') - DEPRECATED: use sort_columns
 * @param {string} [params.sort_order] - Sort order ('asc' or 'desc') - DEPRECATED: use sort_direction
 * @param {string[]} [params.sort_columns] - Array of sort columns (e.g., ['rarity', 'level', 'cost'])
 * @param {string[]} [params.sort_direction] - Array of sort directions ('asc' or 'desc') for each column
 * @param {number} [params.page] - Page number (default: 1, sent as query parameter)
 * @param {number} [params.limit] - Items per page (default: 50, sent as query parameter)
 * @returns {Promise<Object>} Response with PaginatedResponse structure: { data, page, limit, total, has_more }
 */
export const filterProducts = async (params = {}) => {
  try {
    // Extract parameters
    const {
      category_id,
      filters = {},
      group_id, // Can be a single ID or an array of IDs
      numbers,
      product_ids, // Product IDs (alternative to numbers)
      sort_by,
      sort_order,
      sort_columns,
      sort_direction,
      page = 1,
      limit = 50
    } = params;

    // Validate category_id is provided and is an integer
    if (category_id === null || category_id === undefined) {
      throw new Error('category_id is required');
    }
    
    const categoryIdInt = parseInt(category_id, 10);
    if (isNaN(categoryIdInt)) {
      throw new Error('category_id must be a valid integer');
    }

    // Normalize filters to ensure all values are arrays
    const normalizedFilters = {};
    Object.keys(filters).forEach(key => {
      const value = filters[key];
      if (Array.isArray(value)) {
        normalizedFilters[key] = value;
      } else if (value !== null && value !== undefined) {
        normalizedFilters[key] = [value];
      }
    });

    // Build request body (without page/limit - these go in query params)
    const requestBody = {
      category_id: categoryIdInt,
      filters: normalizedFilters
    };

    // Add optional parameters if provided
    if (group_id !== null && group_id !== undefined) {
      // group_id can be a single ID or an array of IDs
      if (Array.isArray(group_id)) {
        requestBody.group_id = group_id.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      } else {
        requestBody.group_id = parseInt(group_id, 10);
      }
    }
    if (numbers !== null && numbers !== undefined) {
      // numbers can be an array of strings or integers
      requestBody.numbers = Array.isArray(numbers) ? numbers : [numbers];
    }
    if (product_ids !== null && product_ids !== undefined) {
      // product_ids can be an array of integers
      requestBody.product_ids = Array.isArray(product_ids) 
        ? product_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
        : [parseInt(product_ids, 10)].filter(id => !isNaN(id));
    }
    // Support new multi-column sorting
    if (sort_columns && Array.isArray(sort_columns) && sort_columns.length > 0) {
      requestBody.sort_columns = sort_columns;
      // sort_direction must match length of sort_columns
      if (sort_direction && Array.isArray(sort_direction) && sort_direction.length === sort_columns.length) {
        requestBody.sort_direction = sort_direction;
      } else {
        // Default to 'asc' for all columns if not provided or mismatched
        requestBody.sort_direction = sort_columns.map(() => 'asc');
      }
    } else if (sort_by) {
      // Legacy support: single column sorting
      requestBody.sort_by = sort_by;
      if (sort_order) {
        requestBody.sort_order = sort_order;
      }
    }

    // Build URL with query parameters for pagination
    let url = API_BASE_URL ? `${API_BASE_URL}/products/filter` : '/products/filter';
    const queryParams = new URLSearchParams();
    queryParams.append('page', String(page));
    queryParams.append('limit', String(limit));
    url += `?${queryParams.toString()}`;

    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to filter products: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error filtering products:', error);
    throw error;
  }
};

/**
 * Search products by name
 * @param {Object} params - Search parameters object
 * @param {string} params.q - Search query for partial name matching (case-insensitive, required)
 * @param {number} [params.page] - Page number (default: 1, sent as query parameter)
 * @param {number} [params.limit] - Items per page (default: 100, sent as query parameter)
 * @returns {Promise<Object>} Response with PaginatedResponse structure: { data, page, limit, total, has_more }
 */
export const searchProducts = async (params = {}) => {
  try {
    const {
      q,
      page = 1,
      limit = 100
    } = params;

    // Validate query is provided
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      throw new Error('Search query (q) is required and must be a non-empty string');
    }

    // Build URL with query parameters
    let url = API_BASE_URL ? `${API_BASE_URL}/products/search` : '/products/search';
    const queryParams = new URLSearchParams();
    queryParams.append('q', q.trim());
    queryParams.append('page', String(page));
    queryParams.append('limit', String(limit));
    url += `?${queryParams.toString()}`;

    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to search products: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching products:', error);
    throw error;
  }
};

/**
 * Fetch a single product by ID
 * @param {number} productId - Product ID
 * @returns {Promise<Object>} Product object
 */
export const fetchProductById = async (productId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/products/${productId}`
      : `/products/${productId}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch product: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching product:', error);
    throw error;
  }
};

/**
 * Fetch a group by ID
 * @param {number} groupId - Group ID
 * @returns {Promise<Object>} Group object
 */
export const fetchGroupById = async (groupId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/groups/${groupId}`
      : `/groups/${groupId}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch group: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching group:', error);
    throw error;
  }
};

/**
 * Fetch current price for a single product
 * @param {number} productId - Product ID
 * @returns {Promise<Object>} Price object
 */
export const fetchCurrentPrice = async (productId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/prices-current/${productId}`
      : `/prices-current/${productId}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch price: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching price:', error);
    return null;
  }
};

/**
 * Fetch price history for a product
 * @param {number} productId - Product ID
 * @returns {Promise<Array>} Array of price history objects
 */
export const fetchPriceHistory = async (productId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/prices-history/by-product/${productId}`
      : `/prices-history/by-product/${productId}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Failed to fetch price history: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.history || data.data || []);
  } catch (error) {
    console.error('Error fetching price history:', error);
    return [];
  }
};

/**
 * Fetch current vendor prices for a product
 * @param {number} productId - Product ID
 * @returns {Promise<Array>} Array of vendor price objects
 */
export const fetchVendorPrices = async (productId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/vendor-prices/by-product?product_ids=${productId}&page=1&limit=100`
      : `/vendor-prices/by-product?product_ids=${productId}&page=1&limit=100`;
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Failed to fetch vendor prices: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.prices || data.data || []);
  } catch (error) {
    console.error('Error fetching vendor prices:', error);
    return [];
  }
};

/**
 * Fetch vendor price history for a product
 * @param {number} productId - Product ID
 * @returns {Promise<Array>} Array of vendor price history objects
 */
export const fetchVendorPriceHistory = async (productId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/vendor-prices/history/by-product?product_ids=${productId}&page=1&limit=100`
      : `/vendor-prices/history/by-product?product_ids=${productId}&page=1&limit=100`;
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Failed to fetch vendor price history: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.history || data.data || []);
  } catch (error) {
    console.error('Error fetching vendor price history:', error);
    return [];
  }
};

/**
 * Fetch current market prices for multiple products
 * @param {Array<number>} productIds - Array of product IDs
 * @returns {Promise<Object>} Map of product_id to price object
 */
export const fetchCurrentPricesBulk = async (productIds) => {
  if (!productIds || productIds.length === 0) {
    return {};
  }

  try {
    const url = API_BASE_URL ? `${API_BASE_URL}/prices-current/bulk` : '/prices-current/bulk';
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_ids: productIds }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch prices: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const priceMap = {};
    
    if (data.prices && Array.isArray(data.prices)) {
      data.prices.forEach(price => {
        const productId = price.product_id || price.productId || price.id;
        if (productId) {
          priceMap[productId] = price;
        }
      });
    }

    return priceMap;
  } catch (error) {
    console.error('Error fetching prices:', error);
    return {};
  }
};

/**
 * Fetch product details for multiple products
 * @param {Array<number>} productIds - Array of product IDs
 * @param {Object} sortParams - Optional sort parameters (sort_columns, sort_direction, sort_by, sort_order)
 * @returns {Promise<Array>} Array of product objects
 */
// Cache and request deduplication for products bulk
const productsBulkCache = {};
const productsBulkPromises = {};

export const fetchProductsBulk = async (productIds, sortParams = {}) => {
  if (!productIds || productIds.length === 0) {
    return [];
  }

  // Create cache key from sorted product IDs and sort parameters
  const sortedIds = [...productIds].sort((a, b) => a - b);
  const sortKey = sortParams.sort_columns 
    ? `_sort_${JSON.stringify(sortParams.sort_columns)}_${JSON.stringify(sortParams.sort_direction || [])}`
    : sortParams.sort_by 
    ? `_sort_${sortParams.sort_by}_${sortParams.sort_order || 'asc'}`
    : '';
  const cacheKey = `products_${sortedIds.join(',')}${sortKey}`;
  
  // Return cached data if available (with longer TTL - 60 seconds for products)
  if (productsBulkCache[cacheKey] && Date.now() - productsBulkCache[cacheKey].timestamp < 60000) {
    return productsBulkCache[cacheKey].data;
  }
  
  // If there's already an in-flight request, return that promise
  if (productsBulkPromises[cacheKey]) {
    return await productsBulkPromises[cacheKey];
  }

  try {
    const url = API_BASE_URL ? `${API_BASE_URL}/products/bulk` : '/products/bulk';
    
    // Build request body with product IDs and optional sort parameters
    const requestBody = { product_ids: productIds };
    
    // Add sort parameters if provided (same format as filterProducts)
    if (sortParams.sort_columns && Array.isArray(sortParams.sort_columns) && sortParams.sort_columns.length > 0) {
      requestBody.sort_columns = sortParams.sort_columns;
      if (sortParams.sort_direction && Array.isArray(sortParams.sort_direction) && sortParams.sort_direction.length === sortParams.sort_columns.length) {
        requestBody.sort_direction = sortParams.sort_direction;
      } else {
        requestBody.sort_direction = sortParams.sort_columns.map(() => 'asc');
      }
    } else if (sortParams.sort_by) {
      // Legacy support: single column sorting
      requestBody.sort_by = sortParams.sort_by;
      if (sortParams.sort_order) {
        requestBody.sort_order = sortParams.sort_order;
      }
    }
    
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const result = data.products || data.data || data || [];
      
      // Cache the result
      productsBulkCache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    }).catch((error) => {
      console.error('Error fetching products bulk:', error);
      throw error;
    }).finally(() => {
      // Remove from in-flight promises
      delete productsBulkPromises[cacheKey];
    });
    
    // Store the promise to deduplicate concurrent requests
    productsBulkPromises[cacheKey] = fetchPromise;
    
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
};

/**
 * Extract extended data from product object
 * @param {Object} product - Product object
 * @returns {Array} Array of extended data items
 */
export const extractExtendedDataFromProduct = (product) => {
  if (!product) return [];
  
  // extended_data_raw is a raw JSON string that needs to be parsed
  if (product.extended_data_raw) {
    try {
      const parsed = typeof product.extended_data_raw === 'string' 
        ? JSON.parse(product.extended_data_raw)
        : product.extended_data_raw;
      
      if (Array.isArray(parsed)) {
        return parsed;
      }
      
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([key, value]) => ({
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
  
  // Fallback to other field names
  const extendedData = product.extended_data || product.extendedData || product.attributes || [];
  
  if (Array.isArray(extendedData)) {
    return extendedData;
  }
  
  if (typeof extendedData === 'object') {
    return Object.entries(extendedData).map(([key, value]) => ({
      key,
      value,
      name: key,
      val: value
    }));
  }
  
  return [];
};

/**
 * Fetch categories
 * @returns {Promise<Array>} Array of category objects
 */
export const fetchCategories = async () => {
  try {
    const url = API_BASE_URL ? `${API_BASE_URL}/categories/` : '/categories/';
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch categories: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.categories || data.data || data || [];
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
};

/**
 * Fetch inventory statistics for a user by category
 * @param {string} userId - User ID
 * @param {number} categoryId - Category ID
 * @returns {Promise<Object>} Statistics object
 */
export const fetchInventoryStatsByCategory = async (userId, categoryId) => {
  try {
    // Reuse getUserInventory which has caching and deduplication
    const inventory = await getUserInventory(userId);
    
    // Convert inventory map back to items object format for stats calculation
    const items = {};
    Object.entries(inventory).forEach(([productId, quantity]) => {
      items[productId] = quantity;
    });
    
    // Calculate stats from items
    const totalCardsOwned = Object.values(items).reduce((sum, qty) => sum + (qty || 0), 0);
    const uniqueCardsOwned = Object.keys(items).length;
    
    // Return stats along with items so they can be reused
    return {
      totalCardsOwned,
      uniqueCardsOwned,
      totalUniqueProducts: 0, // Would need to fetch from products/count endpoint
      items // Include items so they can be reused to avoid duplicate profile fetches
    };
  } catch (error) {
    console.error('Error fetching inventory stats:', error);
    return { totalCardsOwned: 0, uniqueCardsOwned: 0, totalUniqueProducts: 0, items: {} };
  }
};

/**
 * Fetch total product counts by category
 * Uses the filter endpoint with minimal data (limit=1) to get just the total count
 * @param {number} categoryId - Category ID
 * @returns {Promise<number>} Total product count
 */
export const fetchProductCountsByCategory = async (categoryId) => {
  try {
    // Use filter endpoint with minimal limit to get total count efficiently
    const response = await filterProducts({
      category_id: categoryId,
      filters: {},
      page: 1,
      limit: 1 // Only need 1 item to get the total count
    });

    // Extract total from response
    if (response && typeof response === 'object') {
      return response.total || response.count || 0;
    }
    
    return 0;
  } catch (error) {
    console.error('Error fetching product counts:', error);
    return 0;
  }
};

/**
 * Get user inventory
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Map of product_id to quantity
 */
// Cache and request deduplication for profiles
const profileCache = {};
const profilePromises = {};
const usernameProfileCache = {};
const usernameProfilePromises = {};

export const getUserInventory = async (userId) => {
  try {
    const cacheKey = `profile_${userId}`;
    
    // Return cached inventory if available (30s TTL)
    if (profileCache[cacheKey] && Date.now() - profileCache[cacheKey].timestamp < 30000) {
      return profileCache[cacheKey].data;
    }
    
    // If there's already an in-flight inventory request, return that promise
    if (profilePromises[cacheKey]) {
      return await profilePromises[cacheKey];
    }

    // Reuse fetchUserProfile so we only hit /profiles once per userId
    const fetchPromise = fetchUserProfile(userId)
      .then((profile) => {
        // Extract items field from profile object
        let inventoryMap = {};
        if (profile && typeof profile === 'object' && profile.items) {
          Object.entries(profile.items).forEach(([productId, quantity]) => {
            inventoryMap[String(productId)] = quantity;
          });
        }
        
        // Cache the inventory result
        profileCache[cacheKey] = { data: inventoryMap, timestamp: Date.now() };
        return inventoryMap;
      })
      .catch((error) => {
        console.error('Error fetching user inventory:', error);
        return {};
      })
      .finally(() => {
        delete profilePromises[cacheKey];
      });

    profilePromises[cacheKey] = fetchPromise;
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching user inventory:', error);
    return {};
  }
};

export const fetchProfileByUsername = async (username) => {
  if (!username) return null;
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;

  const cacheKey = `profile_username_${normalized}`;

  if (usernameProfileCache[cacheKey] && Date.now() - usernameProfileCache[cacheKey].timestamp < 30000) {
    return usernameProfileCache[cacheKey].data;
  }

  if (usernameProfilePromises[cacheKey]) {
    return usernameProfilePromises[cacheKey];
  }

  const url = API_BASE_URL
    ? `${API_BASE_URL}/profiles/?username=${encodeURIComponent(normalized)}`
    : `/profiles/?username=${encodeURIComponent(normalized)}`;

  const headers = await getAuthHeaders();
  const fetchPromise = fetch(url, { headers })
    .then(async (response) => {
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch profile by username: ${response.status} ${response.statusText}`);
      }
      const profile = await response.json();
      usernameProfileCache[cacheKey] = { data: profile, timestamp: Date.now() };
      return profile;
    })
    .catch((error) => {
      console.error('Error fetching profile by username:', error);
      return null;
    })
    .finally(() => {
      delete usernameProfilePromises[cacheKey];
    });

  usernameProfilePromises[cacheKey] = fetchPromise;
  return fetchPromise;
};

export const getUserInventoryByUsername = async (username) => {
  const profile = await fetchProfileByUsername(username);
  if (!profile || !profile.items) {
    return {};
  }
  const inventoryMap = {};
  Object.entries(profile.items).forEach(([productId, quantity]) => {
    inventoryMap[String(productId)] = quantity;
  });
  return inventoryMap;
};

/**
 * Update inventory items (via profile items field)
 * @param {string} userId - User ID (UUID)
 * @param {Object} items - Map of product_id (string) -> quantity (number). Items with quantity 0 will be deleted.
 * @returns {Promise<Object>} Response with results
 */
export const updateInventoryItems = async (userId, items) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/profiles/?user_id=${userId}`
      : `/profiles/?user_id=${userId}`;
    
    const headers = await getAuthHeaders();
    
    // Get current profile to merge with existing items
    const getResponse = await fetch(url, { headers });
    if (!getResponse.ok) {
      throw new Error(`Failed to fetch profile: ${getResponse.status} ${getResponse.statusText}`);
    }
    
    const profile = await getResponse.json();
    const currentItems = profile.items || {};
    
    // Merge new items with existing items
    const mergedItems = { ...currentItems };
    Object.entries(items).forEach(([productId, quantity]) => {
      const productIdStr = String(productId);
      const quantityInt = typeof quantity === 'number' ? Math.floor(quantity) : parseInt(quantity, 10);
      
      if (quantityInt > 0) {
        // Update or add item
        mergedItems[productIdStr] = quantityInt;
      } else {
        // Delete item (quantity 0 or negative)
        delete mergedItems[productIdStr];
      }
    });
    
    // Update profile with merged items field
    const requestBody = {
      items: mergedItems
    };
    
    console.log('Updating inventory items:', requestBody);
    
    const patchResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to update inventory: ${patchResponse.status} ${patchResponse.statusText}`);
    }

    const data = await patchResponse.json();
    console.log('Update inventory items response:', data);
    return { updated: Object.keys(items).length };
  } catch (error) {
    console.error('Error updating inventory:', error);
    throw error;
  }
};

/**
 * Delete inventory items (via profile items field)
 * @param {string} userId - User ID (UUID)
 * @param {Array<number>} productIds - Array of product IDs to delete
 * @returns {Promise<Object>} Response with deleted count
 */
export const deleteInventoryItems = async (userId, productIds) => {
  try {
    // First, get current profile to get existing items
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/profiles/?user_id=${userId}`
      : `/profiles/?user_id=${userId}`;
    
    const headers = await getAuthHeaders();
    
    // Get current profile
    const getResponse = await fetch(url, { headers });
    if (!getResponse.ok) {
      throw new Error(`Failed to fetch profile: ${getResponse.status} ${getResponse.statusText}`);
    }
    
    const profile = await getResponse.json();
    const currentItems = profile.items || {};
    
    // Remove specified product IDs
    const updatedItems = { ...currentItems };
    productIds.forEach(productId => {
      delete updatedItems[String(productId)];
    });
    
    // Update profile with updated items
    const requestBody = {
      items: updatedItems
    };
    
    console.log('Deleting inventory items:', requestBody);
    
    const patchResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to delete inventory items: ${patchResponse.status} ${patchResponse.statusText}`);
    }

    const data = await patchResponse.json();
    console.log('Delete inventory items response:', data);
    return { deleted: productIds.length };
  } catch (error) {
    console.error('Error deleting inventory items:', error);
    throw error;
  }
};

/**
 * Bulk update inventory items (legacy function name, now uses updateInventoryItems)
 * @param {string} userId - User ID (UUID)
 * @param {Object} items - Map of product_id (string) -> quantity (number). Items with quantity 0 will be deleted.
 * @returns {Promise<Object>} Response with results
 */
export const bulkUpdateInventory = async (userId, items) => {
  return await updateInventoryItems(userId, items);
};

/**
 * Fetch deck lists for a user
 * @param {string} userId - User ID (UUID)
 * @param {number} categoryId - Optional category ID to filter by
 * @returns {Promise<Array>} Array of deck list objects
 */
// Cache and request deduplication for deck lists
const deckListsCache = {};
const deckListsPromises = {};

export const fetchDeckLists = async (userId, categoryId = null) => {
  try {
    const cacheKey = `user_${userId}_cat_${categoryId || 'all'}`;
    
    // Return cached data if available (with longer TTL - 30 seconds)
    if (deckListsCache[cacheKey] && Date.now() - deckListsCache[cacheKey].timestamp < 30000) {
      return deckListsCache[cacheKey].data;
    }
    
    // If there's already an in-flight request, return that promise
    if (deckListsPromises[cacheKey]) {
      return await deckListsPromises[cacheKey];
    }
    
    let url = API_BASE_URL ? `${API_BASE_URL}/deck-lists/` : '/deck-lists/';
    
    const params = new URLSearchParams();
    params.append('user_id', userId);
    if (categoryId !== null) {
      params.append('category_id', categoryId);
    }
    
    url += `?${params.toString()}`;
    
    console.log('Fetching deck lists from:', url);
    
    const headers = await getAuthHeaders();
    const fetchPromise = fetch(url, { headers }).then(async (response) => {
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`Failed to fetch deck lists: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Deck lists API response:', data);
      
      // Handle different response formats
      let result = [];
      if (data && typeof data === 'object') {
        if (data.deck_lists && Array.isArray(data.deck_lists)) {
          result = data.deck_lists;
        } else if (data.data && Array.isArray(data.data)) {
          result = data.data;
        } else if (Array.isArray(data)) {
          result = data;
        }
      }
      
      // Cache the result
      deckListsCache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    }).catch((error) => {
      console.error('Error fetching deck lists:', error);
      return [];
    }).finally(() => {
      // Remove from in-flight promises
      delete deckListsPromises[cacheKey];
    });
    
    // Store the promise to deduplicate concurrent requests
    deckListsPromises[cacheKey] = fetchPromise;
    
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching deck lists:', error);
    return [];
  }
};

// Cache and request deduplication for all deck lists
const allDeckListsCache = {};
const allDeckListsPromises = {};

/**
 * Fetch all deck lists (for all users)
 * @param {number} categoryId - Optional category ID to filter by
 * @returns {Promise<Array>} Array of deck list objects
 */
export const fetchAllDeckLists = async (categoryId = null) => {
  try {
    const cacheKey = `all_cat_${categoryId || 'all'}`;
    
    // Return cached data if available (with longer TTL - 30 seconds)
    if (allDeckListsCache[cacheKey] && Date.now() - allDeckListsCache[cacheKey].timestamp < 30000) {
      return allDeckListsCache[cacheKey].data;
    }
    
    // If there's already an in-flight request, return that promise
    if (allDeckListsPromises[cacheKey]) {
      return await allDeckListsPromises[cacheKey];
    }
    
    let url = API_BASE_URL ? `${API_BASE_URL}/deck-lists/` : '/deck-lists/';
    
    const params = new URLSearchParams();
    // Don't include user_id to get all decks
    if (categoryId !== null) {
      params.append('category_id', categoryId);
    }
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    console.log('Fetching all deck lists from:', url);
    
    const headers = await getAuthHeaders();
    const fetchPromise = fetch(url, { headers }).then(async (response) => {
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`Failed to fetch deck lists: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('All deck lists API response:', data);
      
      // Handle different response formats
      let result = [];
      if (data && typeof data === 'object') {
        if (data.deck_lists && Array.isArray(data.deck_lists)) {
          result = data.deck_lists;
        } else if (data.data && Array.isArray(data.data)) {
          result = data.data;
        } else if (Array.isArray(data)) {
          result = data;
        }
      }
      
      // Cache the result
      allDeckListsCache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    }).catch((error) => {
      console.error('Error fetching all deck lists:', error);
      return [];
    }).finally(() => {
      // Remove from in-flight promises
      delete allDeckListsPromises[cacheKey];
    });
    
    // Store the promise to deduplicate concurrent requests
    allDeckListsPromises[cacheKey] = fetchPromise;
    
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching all deck lists:', error);
    return [];
  }
};

/**
 * Fetch a single deck list by ID
 * @param {number} deckListId - Deck list ID
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<Object|null>} Deck list object or null if not found
 */
export const fetchDeckList = async (deckListId, userId = null) => {
  try {
    let url = API_BASE_URL 
      ? `${API_BASE_URL}/deck-lists/${deckListId}`
      : `/deck-lists/${deckListId}`;
    
    if (userId) {
      url += `?user_id=${userId}`;
    }
    
    console.log('Fetching deck list from:', url);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch deck list: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Deck list API response:', data);
    
    return data;
  } catch (error) {
    console.error('Error fetching deck list:', error);
    return null;
  }
};

/**
 * Create a new deck list
 * @param {string} userId - User ID (UUID)
 * @param {number} categoryId - Category ID
 * @param {string} name - Deck list name
 * @param {Object} items - Optional initial items map (product_id to quantity)
 * @returns {Promise<Object>} Created deck list object
 */
export const createDeckList = async (userId, categoryId, name, items = {}) => {
  try {
    const url = API_BASE_URL ? `${API_BASE_URL}/deck-lists/` : '/deck-lists/';
    
    const requestBody = {
      user_id: userId,
      category_id: categoryId,
      name: name,
      items: items
    };
    
    console.log('Creating deck list:', requestBody);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to create deck list: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Create deck list response:', data);
    return data;
  } catch (error) {
    console.error('Error creating deck list:', error);
    throw error;
  }
};

/**
 * Update a deck list's name
 * @param {number} deckListId - Deck list ID
 * @param {string} userId - User ID (UUID)
 * @param {string} name - New name for the deck list
 * @returns {Promise<Object>} Updated deck list object
 */
export const updateDeckListName = async (deckListId, userId, name) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/deck-lists/${deckListId}`
      : `/deck-lists/${deckListId}`;
    
    const requestBody = {
      user_id: userId,
      name: name
    };
    
    console.log('Updating deck list name:', requestBody);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to update deck list: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Update deck list response:', data);
    return data;
  } catch (error) {
    console.error('Error updating deck list:', error);
    throw error;
  }
};

/**
 * Delete a deck list
 * @param {number} deckListId - Deck list ID
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<Object>} Response object
 */
export const deleteDeckList = async (deckListId, userId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/deck-lists/${deckListId}?user_id=${userId}`
      : `/deck-lists/${deckListId}?user_id=${userId}`;
    
    console.log('Deleting deck list:', url);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to delete deck list: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Delete deck list response:', data);
    return data;
  } catch (error) {
    console.error('Error deleting deck list:', error);
    throw error;
  }
};

/**
 * Update deck list items (bulk upsert)
 * @param {number} deckListId - Deck list ID
 * @param {string} userId - User ID (UUID)
 * @param {Object} items - Map of product_id (int or string) to quantity (int, min: 1)
 * @returns {Promise<Object>} Response with results
 */
export const updateDeckListItems = async (deckListId, userId, items) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/deck-lists/${deckListId}/items`
      : `/deck-lists/${deckListId}/items`;
    
    // Normalize items: ensure product IDs are strings and quantities are positive integers
    // Items with quantity 0 should be deleted, not updated
    const normalizedItems = {};
    Object.entries(items).forEach(([productId, quantity]) => {
      // Keep product ID as string (API expects string keys)
      const productIdStr = String(productId);
      const quantityInt = typeof quantity === 'number' ? Math.floor(quantity) : parseInt(quantity, 10);
      if (productIdStr && !isNaN(quantityInt) && quantityInt > 0) {
        normalizedItems[productIdStr] = quantityInt;
      }
    });
    
    // Don't send request if no valid items to update
    if (Object.keys(normalizedItems).length === 0) {
      console.log('No valid items to update, skipping API call');
      return { updated: 0 };
    }
    
    const requestBody = {
      user_id: userId,
      items: normalizedItems
    };
    
    console.log('Updating deck list items:', requestBody);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to update deck list items: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Update deck list items response:', data);
    return data;
  } catch (error) {
    console.error('Error updating deck list items:', error);
    throw error;
  }
};

/**
 * Delete deck list items (bulk delete)
 * @param {number} deckListId - Deck list ID
 * @param {string} userId - User ID (UUID)
 * @param {Array<number>} productIds - Array of product IDs to delete
 * @returns {Promise<Object>} Response with deleted count
 */
export const deleteDeckListItems = async (deckListId, userId, productIds) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/deck-lists/${deckListId}/items`
      : `/deck-lists/${deckListId}/items`;
    
    const requestBody = {
      user_id: userId,
      product_ids: productIds
    };
    
    console.log('Deleting deck list items:', requestBody);
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to delete deck list items: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Delete deck list items response:', data);
    return data;
  } catch (error) {
    console.error('Error deleting deck list items:', error);
    throw error;
  }
};

// Cache for category rules to avoid duplicate fetches
const categoryRulesCache = {};
const categoryRulesPromises = {}; // Track in-flight requests to deduplicate

/**
 * Fetch category rules
 * @param {number} categoryId - Optional category ID to filter rules
 * @returns {Promise<Array>} Array of category rule objects
 */
export const fetchCategoryRules = async (categoryId = null) => {
  try {
    // Use cache key: null for all rules, or the categoryId for specific rules
    const cacheKey = categoryId === null ? 'all' : String(categoryId);
    
    // Return cached data if available
    if (categoryRulesCache[cacheKey]) {
      return categoryRulesCache[cacheKey];
    }
    
    // If there's already an in-flight request, return that promise
    if (categoryRulesPromises[cacheKey]) {
      return await categoryRulesPromises[cacheKey];
    }
    
    // Create new request
    let url = API_BASE_URL ? `${API_BASE_URL}/categories/rules` : '/categories/rules';
    
    // Add category_id as query parameter if provided
    if (categoryId !== null && categoryId !== undefined) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}category_id=${categoryId}`;
    }
    
    const fetchPromise = fetch(url).then(async (response) => {
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`Failed to fetch category rules: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // API returns a single object when category_id is provided, or array when not
      let result;
      if (categoryId !== null && categoryId !== undefined) {
        // Single object response
        result = data;
      } else {
        // Array response when no category_id
        result = data.rules || data.data || (Array.isArray(data) ? data : []);
      }
      
      // Cache the result
      categoryRulesCache[cacheKey] = result;
      return result;
    }).catch((error) => {
      console.error('Error fetching category rules:', error);
      return [];
    }).finally(() => {
      // Remove from in-flight promises
      delete categoryRulesPromises[cacheKey];
    });
    
    // Store the promise to deduplicate concurrent requests
    categoryRulesPromises[cacheKey] = fetchPromise;
    
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching category rules:', error);
    return [];
  }
};

/**
 * Fetch groups by category
 * @param {number} categoryId - Category ID
 * @returns {Promise<Array>} Array of group objects
 */
export const fetchGroupsByCategory = async (categoryId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/groups/by-category/${categoryId}`
      : `/groups/by-category/${categoryId}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Failed to fetch groups: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.groups || data.data || data || [];
  } catch (error) {
    console.error('Error fetching groups:', error);
    return [];
  }
};

/**
 * Fetch user profile
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<Object|null>} Profile object or null if not found
 *
 * This function is heavily used across contexts and components
 * (currency, TCG percentage, navigation bar, profile page, etc.),
 * so we add caching and in-flight request deduplication to avoid
 * multiple `/profiles/?user_id=...` calls on initial page load.
 */
const userProfileCache = {};
const userProfilePromises = {};

export const fetchUserProfile = async (userId) => {
  if (!userId) {
    return null;
  }

  try {
    const cacheKey = `user_profile_${userId}`;

    // Return cached profile if it's still fresh (30s TTL)
    if (userProfileCache[cacheKey] && Date.now() - userProfileCache[cacheKey].timestamp < 30000) {
      return userProfileCache[cacheKey].data;
    }

    // If there's already an in-flight request, return that promise
    if (userProfilePromises[cacheKey]) {
      return await userProfilePromises[cacheKey];
    }

    const url = API_BASE_URL 
      ? `${API_BASE_URL}/profiles/?user_id=${userId}`
      : `/profiles/?user_id=${userId}`;
    
    const headers = await getAuthHeaders();

    const fetchPromise = fetch(url, { headers })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error(`Failed to fetch profile: ${response.status} ${response.statusText}`);
        }

        const profile = await response.json();
        // Cache the profile
        userProfileCache[cacheKey] = { data: profile, timestamp: Date.now() };
        return profile;
      })
      .catch((error) => {
        console.error('Error fetching user profile:', error);
        // On error, don't cache; just rethrow so callers can handle
        throw error;
      })
      .finally(() => {
        delete userProfilePromises[cacheKey];
      });

    // Store the in-flight promise for deduplication
    userProfilePromises[cacheKey] = fetchPromise;
    return await fetchPromise;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
};

/**
 * Update user profile currency
 * @param {string} userId - User ID (UUID)
 * @param {string} currency - Currency code (USD, CAD, EUR)
 * @returns {Promise<Object>} Updated profile object
 */
export const updateUserCurrency = async (userId, currency) => {
  try {
    const url = API_BASE_URL
      ? `${API_BASE_URL}/profiles/?user_id=${userId}`
      : `/profiles/?user_id=${userId}`;

    const headers = await getAuthHeaders();

    // Get current profile first to preserve other fields
    const getResponse = await fetch(url, { headers });
    if (!getResponse.ok && getResponse.status !== 404) {
      throw new Error(`Failed to fetch profile: ${getResponse.status} ${getResponse.statusText}`);
    }

    const currentProfile = getResponse.status === 404 ? {} : await getResponse.json();

    // Update currency field
    const requestBody = {
      ...currentProfile,
      currency: currency.toUpperCase()
    };

    const postResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to update currency: ${postResponse.status} ${postResponse.statusText}`);
    }

    return await postResponse.json();
  } catch (error) {
    console.error('Error updating user currency:', error);
    throw error;
  }
};

/**
 * Update user profile TCG percentage
 * @param {string} userId - User ID (UUID)
 * @param {number} tcgPercentage - TCG percentage value (0-100)
 * @returns {Promise<Object>} Updated profile object
 */
export const updateUserTcgPercentage = async (userId, tcgPercentage) => {
  try {
    const url = API_BASE_URL
      ? `${API_BASE_URL}/profiles/?user_id=${userId}`
      : `/profiles/?user_id=${userId}`;

    const headers = await getAuthHeaders();

    // Get current profile first to preserve other fields
    const getResponse = await fetch(url, { headers });
    if (!getResponse.ok && getResponse.status !== 404) {
      throw new Error(`Failed to fetch profile: ${getResponse.status} ${getResponse.statusText}`);
    }

    const currentProfile = getResponse.status === 404 ? {} : await getResponse.json();

    // Update tcg_percentage field
    const requestBody = {
      ...currentProfile,
      tcg_percentage: Math.max(0, Math.min(100, Number(tcgPercentage)))
    };

    const postResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Failed to update TCG percentage: ${postResponse.status} ${postResponse.statusText}`);
    }

    return await postResponse.json();
  } catch (error) {
    console.error('Error updating user TCG percentage:', error);
    throw error;
  }
};

/**
 * Fetch unique key-value pairs for product extended data by category
 * @param {number} categoryId - Category ID
 * @returns {Promise<Object>} Object with keys and key_value_pairs
 */
export const fetchProductExtendedDataKeyValues = async (categoryId) => {
  try {
    // Use the correct endpoint: /product-extended-data/by-category/{category_id}/key-values
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/product-extended-data/by-category/${categoryId}/key-values`
      : `/product-extended-data/by-category/${categoryId}/key-values`;
    
    console.log(`[fetchProductExtendedDataKeyValues] Fetching from: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[fetchProductExtendedDataKeyValues] 404 - No data found for category ${categoryId}`);
        return { keys: [], key_value_pairs: {}, keyValuePairs: {} };
      }
      const errorText = await response.text();
      console.error(`[fetchProductExtendedDataKeyValues] Error ${response.status}:`, errorText);
      throw new Error(`Failed to fetch key values: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[fetchProductExtendedDataKeyValues] Raw API response:`, data);
    console.log(`[fetchProductExtendedDataKeyValues] Response type:`, Array.isArray(data) ? 'Array' : typeof data);
    console.log(`[fetchProductExtendedDataKeyValues] Response keys:`, typeof data === 'object' && data !== null ? Object.keys(data) : 'N/A');
    
    // The API returns a direct object where keys are attribute names and values are arrays
    // Example: { "CardType": ["Base", "Command", ...], "Color": ["Red", "Blue", ...], ... }
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      // Check if it's wrapped in a response object (has keys/key_value_pairs fields)
      if (data.keys !== undefined || data.key_value_pairs !== undefined || data.keyValuePairs !== undefined) {
        // Wrapped format: { keys: [...], key_value_pairs: {...} }
        const keys = data.keys || [];
        const keyValuePairs = data.key_value_pairs || data.keyValuePairs || {};
        const finalKeys = keys.length > 0 ? keys : Object.keys(keyValuePairs);
        
        console.log(`[fetchProductExtendedDataKeyValues] Wrapped format - keys:`, finalKeys);
        return {
          keys: finalKeys,
          key_value_pairs: keyValuePairs,
          keyValuePairs: keyValuePairs
        };
      } else {
        // Direct format: { "CardType": [...], "Color": [...], ... }
        // The object itself IS the key_value_pairs mapping
        const keys = Object.keys(data);
        const keyValuePairs = data;
        
        console.log(`[fetchProductExtendedDataKeyValues] Direct format - keys:`, keys);
        return {
          keys: keys,
          key_value_pairs: keyValuePairs,
          keyValuePairs: keyValuePairs
        };
      }
    }
    
    // Handle array format (if API ever returns arrays)
    if (Array.isArray(data)) {
      console.log(`[fetchProductExtendedDataKeyValues] Processing as array, length: ${data.length}`);
      const keys = [];
      const keyValuePairs = {};
      data.forEach((item, index) => {
        const key = item.key || item.name || item.attribute_key;
        const values = item.values || item.value_list || [];
        if (key && values.length > 0) {
          keys.push(key);
          keyValuePairs[key] = values;
        }
      });
      return { keys, key_value_pairs: keyValuePairs, keyValuePairs };
    }
    
    console.warn(`[fetchProductExtendedDataKeyValues] Unexpected response format:`, typeof data);
    return { keys: [], key_value_pairs: {}, keyValuePairs: {} };
  } catch (error) {
    console.error(`[fetchProductExtendedDataKeyValues] Error for category ${categoryId}:`, error);
    return { keys: [], key_value_pairs: {}, keyValuePairs: {} };
  }
};

