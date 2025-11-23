/**
 * Calculate delta (changes) between base items and staged items
 * @param {Object} baseItems - Base items map { productId: quantity }
 * @param {Object} stagedItems - Staged items map { productId: quantity }
 * @returns {Object} Object with addedItems, updatedItems, removedItems, and mergedItems
 */
export const calculateDelta = (baseItems, stagedItems) => {
  const addedItems = {};
  const updatedItems = {};
  const removedItems = [];

  // Merge staged changes with base items to get current effective state
  const mergedItems = { ...baseItems };
  Object.entries(stagedItems).forEach(([productId, quantity]) => {
    if (quantity > 0) {
      mergedItems[productId] = quantity;
    } else if (quantity === 0) {
      // Mark for deletion
      delete mergedItems[productId];
    } else {
      delete mergedItems[productId];
    }
  });

  // Find added items (not in original baseItems)
  Object.entries(mergedItems).forEach(([productId, quantity]) => {
    if (!(productId in baseItems) && quantity > 0) {
      addedItems[productId] = quantity;
    }
  });

  // Find updated items (quantity changed)
  Object.entries(mergedItems).forEach(([productId, quantity]) => {
    const originalQuantity = baseItems[productId] || 0;
    if (productId in baseItems && quantity !== originalQuantity && quantity > 0) {
      updatedItems[productId] = {
        oldQuantity: originalQuantity,
        newQuantity: quantity
      };
    }
  });

  // Find removed items (were in original but not in merged, or explicitly set to 0)
  Object.keys(baseItems).forEach(productId => {
    if (!(productId in mergedItems)) {
      removedItems.push(productId);
    }
  });
  
  // Also check staged items explicitly set to 0
  Object.entries(stagedItems).forEach(([productId, quantity]) => {
    if (quantity === 0 && !removedItems.includes(productId)) {
      removedItems.push(productId);
    }
  });

  return { addedItems, updatedItems, removedItems, mergedItems };
};

