/**
 * Calculate the current merged state (base + staged)
 * @param {Object} baseItems - Base items map
 * @param {Object} stagedItems - Staged items map
 * @returns {Object} Merged items map
 */
export const getMergedItems = (baseItems, stagedItems) => {
  const merged = { ...baseItems };
  Object.entries(stagedItems).forEach(([productId, quantity]) => {
    if (quantity > 0) {
      merged[productId] = quantity;
    } else {
      delete merged[productId];
    }
  });
  return merged;
};

/**
 * Apply import to staged items (exact quantities - replaces existing)
 * Used for deck building where import sets exact quantities
 * @param {Object} baseItems - Base items map
 * @param {Object} stagedItems - Current staged items map
 * @param {Object} importedItems - Imported items map { productId: quantity }
 * @returns {Object} New staged items map
 */
export const applyImportExact = (baseItems, stagedItems, importedItems) => {
  const currentMerged = getMergedItems(baseItems, stagedItems);
  const newStagedItems = {};
  
  // Add/update items from import (exact quantities)
  Object.entries(importedItems).forEach(([productId, quantity]) => {
    const currentQuantity = currentMerged[productId] || 0;
    if (quantity !== currentQuantity) {
      newStagedItems[productId] = quantity;
    }
  });

  // Remove items not in import (set to 0)
  Object.keys(currentMerged).forEach(productId => {
    if (!importedItems[productId] && currentMerged[productId] > 0) {
      newStagedItems[productId] = 0; // Mark for removal
    }
  });

  return newStagedItems;
};

/**
 * Apply import to staged items (additive - adds to existing)
 * Used for inventory where import adds quantities
 * @param {Object} baseItems - Base items map
 * @param {Object} stagedItems - Current staged items map
 * @param {Object} importedItems - Imported items map { productId: quantityToAdd }
 * @returns {Object} New staged items map (merged with existing staged)
 */
export const applyImportAdditive = (baseItems, stagedItems, importedItems) => {
  const currentMerged = getMergedItems(baseItems, stagedItems);
  // Merge with existing staged changes instead of replacing
  const newStagedItems = { ...stagedItems };
  
  // Add quantities from import (additive)
  Object.entries(importedItems).forEach(([productId, quantityToAdd]) => {
    const currentQuantity = currentMerged[productId] || 0;
    const newQuantity = currentQuantity + quantityToAdd; // ADD to existing
    if (newQuantity > 0) {
      newStagedItems[productId] = newQuantity;
    } else {
      // If result is 0 or less, remove from staged
      delete newStagedItems[productId];
    }
  });

  return newStagedItems;
};

/**
 * Apply removal to staged items (subtractive)
 * @param {Object} baseItems - Base items map
 * @param {Object} stagedItems - Current staged items map
 * @param {Object} removedItems - Removed items map { productId: quantityAfterRemoval }
 * @returns {Object} New staged items map (merged with existing staged)
 */
export const applyRemoval = (baseItems, stagedItems, removedItems) => {
  const currentMerged = getMergedItems(baseItems, stagedItems);
  // Merge with existing staged changes instead of replacing
  const newStagedItems = { ...stagedItems };
  
  // Subtract quantities from removal
  Object.entries(removedItems).forEach(([productId, quantityAfterRemoval]) => {
    if (quantityAfterRemoval > 0) {
      newStagedItems[productId] = quantityAfterRemoval;
    } else {
      // If result is 0 or less, mark for removal
      newStagedItems[productId] = 0;
    }
  });

  return newStagedItems;
};

