/**
 * Build sidebar items from products and quantities
 * @param {Array} products - Array of products
 * @param {Object} baseItems - Base items map { productId: quantity }
 * @param {Object} stagedItems - Staged items map { productId: quantity }
 * @param {Function} getProductAttributes - Function to get product attributes
 * @param {string} sortBy - Sort method: 'name' | 'attributes' (default: 'name')
 * @returns {Array} Array of sidebar items { product, productId, quantity, changeStatus }
 */
export const buildSidebarItems = (products, baseItems, stagedItems, getProductAttributes = null, sortBy = 'name') => {
  const items = products.map(product => {
    const productId = String(product.product_id || product.id);
    const quantity = stagedItems[productId] !== undefined 
      ? stagedItems[productId] 
      : (baseItems[productId] || 0);
    
    // Determine change status for visual highlighting
    const originalQuantity = baseItems[productId] || 0;
    const stagedQuantity = stagedItems[productId];
    let changeStatus = 'unchanged';
    if (stagedQuantity !== undefined) {
      if (stagedQuantity > originalQuantity) {
        changeStatus = 'added';
      } else if (stagedQuantity < originalQuantity) {
        changeStatus = 'removed';
      }
    }
    
    return { product, productId, quantity, changeStatus };
  })
  .filter(item => item.quantity > 0);

  // Sort items
  if (sortBy === 'attributes' && getProductAttributes) {
    items.sort((a, b) => {
      const aAttrs = getProductAttributes(a.productId, a.product);
      const bAttrs = getProductAttributes(b.productId, b.product);
      
      // Sort by color first
      const aColor = aAttrs.color || '';
      const bColor = bAttrs.color || '';
      if (aColor !== bColor) {
        return aColor.localeCompare(bColor);
      }
      
      // Then by level (descending)
      const aLevel = aAttrs.level || '';
      const bLevel = bAttrs.level || '';
      if (aLevel !== bLevel) {
        const aLevelNum = parseInt(aLevel, 10);
        const bLevelNum = parseInt(bLevel, 10);
        if (!isNaN(aLevelNum) && !isNaN(bLevelNum)) {
          return bLevelNum - aLevelNum; // Descending
        }
        return bLevel.localeCompare(aLevel);
      }
      
      // Finally by cost (descending)
      const aCost = aAttrs.cost !== null ? aAttrs.cost : -Infinity;
      const bCost = bAttrs.cost !== null ? bAttrs.cost : -Infinity;
      if (aCost !== bCost) {
        return bCost - aCost; // Descending
      }
      
      // If all attributes are equal, sort by name as tiebreaker
      const aName = (a.product.name || '').toLowerCase();
      const bName = (b.product.name || '').toLowerCase();
      return aName.localeCompare(bName);
    });
  } else {
    // Default: sort by name
    items.sort((a, b) => {
      const aName = (a.product.name || '').toLowerCase();
      const bName = (b.product.name || '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  return items;
};

