// Favorites service for managing user favorite products using profiles API
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
 * Get all favorited product IDs for a user (from profile favorites field)
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<Set<string>>} Set of product IDs (as strings)
 */
export const getFavorites = async (userId) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/profiles?user_id=${userId}`
      : `/profiles?user_id=${userId}`;
    
    const headers = await getAuthHeaders();
    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        return new Set();
      }
      throw new Error(`Failed to fetch profile: ${response.status} ${response.statusText}`);
    }

    const profile = await response.json();
    
    // Extract favorites field from profile object
    // Favorites is a JSON object with product IDs as keys (same structure as items)
    if (profile && typeof profile === 'object' && profile.favorites) {
      const productIds = Object.keys(profile.favorites).map(id => String(id));
      return new Set(productIds);
    }
    
    return new Set();
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return new Set();
  }
};

/**
 * Check if a product is favorited (from profile favorites field)
 * @param {string} userId - User ID (UUID)
 * @param {number} productId - Product ID
 * @returns {Promise<boolean>} True if favorited
 */
export const isFavorited = async (userId, productId) => {
  try {
    // Get all favorites and check if productId is in the set
    const favorites = await getFavorites(userId);
    return favorites.has(String(productId));
  } catch (error) {
    console.error('Error checking favorite status:', error);
    return false;
  }
};

/**
 * Toggle favorite status for a product (via profile favorites field)
 * @param {string} userId - User ID (UUID)
 * @param {number} productId - Product ID
 * @param {boolean} isFavorite - Current favorite status (optional, will fetch if not provided)
 * @returns {Promise<boolean>} New favorite status
 */
export const toggleFavorite = async (userId, productId, isFavorite = null) => {
  try {
    const url = API_BASE_URL 
      ? `${API_BASE_URL}/profiles?user_id=${userId}`
      : `/profiles?user_id=${userId}`;
    
    const headers = await getAuthHeaders();
    
    // If status not provided, fetch it
    if (isFavorite === null) {
      isFavorite = await isFavorited(userId, productId);
    }
    
    // Get current profile to get existing favorites
    const getResponse = await fetch(url, { headers });
    if (!getResponse.ok) {
      throw new Error(`Failed to fetch profile: ${getResponse.status} ${getResponse.statusText}`);
    }
    
    const profile = await getResponse.json();
    const currentFavorites = profile.favorites || {};
    const updatedFavorites = { ...currentFavorites };
    const productIdStr = String(productId);
    
    if (isFavorite) {
      // Remove favorite
      delete updatedFavorites[productIdStr];
    } else {
      // Add favorite (favorites use quantity 1, same structure as items)
      updatedFavorites[productIdStr] = 1;
    }
    
    // Update profile with updated favorites field
    const requestBody = {
      favorites: updatedFavorites
    };
    
    const patchResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!patchResponse.ok) {
      throw new Error(`Failed to update favorites: ${patchResponse.status} ${patchResponse.statusText}`);
    }
    
    return !isFavorite; // Return new status
  } catch (error) {
    console.error('Error toggling favorite:', error);
    throw error;
  }
};
