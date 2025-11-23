import { filterProducts, fetchCurrentPricesBulk, extractExtendedDataFromProduct } from './api';

/**
 * Normalize card numbers for consistent matching
 * - Numeric-only: Remove leading zeros (e.g., "001" -> "1")
 * - Alphanumeric: Keep as-is (e.g., "GD01-008" -> "GD01-008")
 */
export const normalizeCardNumber = (num) => {
  if (!num) return null;
  const str = String(num).trim().toUpperCase();
  // For numeric-only card numbers, remove leading zeros
  // For alphanumeric (like "GD01-008"), keep as-is
  if (/^\d+$/.test(str)) {
    return str.replace(/^0+/, '') || '0';
  }
  return str;
};

/**
 * Extract card number from product (checks product.number and extended data)
 */
export const extractProductCardNumber = (product) => {
  // First check the product's direct number field
  let productNumber = product.number || product.Number || null;
  
  // If not found, check extended data
  if (!productNumber) {
    const extendedData = extractExtendedDataFromProduct(product);
    extendedData.forEach(item => {
      const key = (item.key || item.name || '').toUpperCase();
      if (key === 'NUMBER') {
        productNumber = (item.value || item.val || '').trim();
      }
    });
  }
  
  return productNumber;
};

/**
 * Fetch products by card numbers with pagination support
 * @param {number} categoryId - Category ID
 * @param {Set<string>} cardNumbersToFind - Set of card numbers to find
 * @param {Function} mergeProductsIntoMap - Optional callback to merge products into a map
 * @returns {Promise<Object>} Object with cardNumberToProducts map and allProductsData array
 */
export const fetchProductsByCardNumbers = async (categoryId, cardNumbersToFind, mergeProductsIntoMap = null) => {
  const cardNumberToProducts = {};
  const allProductsData = [];

  // Initialize empty arrays for all card numbers
  cardNumbersToFind.forEach(cardNumber => {
    cardNumberToProducts[cardNumber] = [];
  });

  if (cardNumbersToFind.size === 0) {
    return { cardNumberToProducts, allProductsData };
  }

  let currentPage = 1;
  let hasMore = true;
  const limit = 1000; // Max limit per API specification

  // Fetch all pages of results
  while (hasMore) {
    const filterParams = {
      category_id: parseInt(categoryId, 10),
      group_id: null,
      numbers: Array.from(cardNumbersToFind),
      sort_by: 'name',
      sort_order: 'asc',
      page: currentPage,
      limit: limit
    };

    const response = await filterProducts(filterParams);
    let productsData = [];
    let hasMorePages = false;
    
    if (response && typeof response === 'object') {
      if (Array.isArray(response)) {
        productsData = response;
      } else if (response.products && Array.isArray(response.products)) {
        productsData = response.products;
      } else if (response.data && Array.isArray(response.data)) {
        productsData = response.data;
      } else if (response.results && Array.isArray(response.results)) {
        productsData = response.results;
      }
      
      // Check pagination info
      hasMorePages = response.has_more !== undefined ? response.has_more : (productsData.length === limit);
    }

    if (productsData.length > 0) {
      allProductsData.push(...productsData);
    }

    // Check if we need to fetch more pages
    hasMore = hasMorePages && productsData.length === limit;
    currentPage++;
    
    // Safety limit: don't fetch more than 10 pages (10,000 products max)
    if (currentPage > 10) {
      console.warn('Import: Reached pagination limit (10 pages), some products may be missing');
      break;
    }
  }

  if (allProductsData.length > 0) {
    // Fetch prices for all products at once
    const productIds = allProductsData.map(p => p.product_id || p.id).filter(id => id !== undefined && id !== null);
    let prices = {};
    if (productIds.length > 0) {
      try {
        prices = await fetchCurrentPricesBulk(productIds);
      } catch (err) {
        console.error('Error fetching prices:', err);
      }
    }

    // Create a map of normalized card numbers to original card numbers
    const normalizedCardNumberMap = {};
    cardNumbersToFind.forEach(originalNumber => {
      const normalized = normalizeCardNumber(originalNumber);
      if (!normalizedCardNumberMap[normalized]) {
        normalizedCardNumberMap[normalized] = [];
      }
      normalizedCardNumberMap[normalized].push(originalNumber);
    });

    // Group products by their number
    allProductsData.forEach(product => {
      const productNumber = extractProductCardNumber(product);

      if (productNumber) {
        const normalizedProductNumber = normalizeCardNumber(productNumber);
        const matchingCardNumbers = normalizedCardNumberMap[normalizedProductNumber];
        
        if (matchingCardNumbers && matchingCardNumbers.length > 0) {
          // Add to all matching card numbers (in case of duplicates like "001" and "1")
          matchingCardNumbers.forEach(cardNumber => {
            if (cardNumberToProducts.hasOwnProperty(cardNumber)) {
              const productId = product.product_id || product.id;
              const price = prices[parseInt(productId, 10)];
              const marketPrice = price?.market_price || price?.marketPrice;
              
              cardNumberToProducts[cardNumber].push({
                product,
                productId,
                marketPrice: marketPrice !== null && marketPrice !== undefined 
                  ? (typeof marketPrice === 'number' ? marketPrice : parseFloat(marketPrice))
                  : Infinity // If no price, treat as highest
              });
            }
          });
        }
      }
    });

    // Sort each card number's products by market price (lowest first), then by product_id for consistency
    Object.keys(cardNumberToProducts).forEach(cardNumber => {
      cardNumberToProducts[cardNumber].sort((a, b) => {
        if (a.marketPrice !== b.marketPrice) {
          return a.marketPrice - b.marketPrice;
        }
        return (a.productId || '').localeCompare(b.productId || '');
      });
    });

    // Merge products into map if callback provided
    if (mergeProductsIntoMap) {
      mergeProductsIntoMap(allProductsData);
    }
  }

  return { cardNumberToProducts, allProductsData };
};

/**
 * Parse import text and extract card numbers and quantities
 * Format: "{quantity}x {card number} [card name]"
 * @param {string} importText - Import text to parse
 * @returns {Array} Array of { quantity, cardNumber, cardName, lineIndex }
 */
export const parseImportText = (importText) => {
  const lines = importText.trim().split('\n').filter(line => line.trim());
  const parsed = [];
  const errors = [];
  const cardNumbersToFind = new Set();

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    const match = trimmedLine.match(/^(\d+)\s*x?\s*([^\s]+)(?:\s+(.+))?$/);
    if (!match) {
      errors.push(`Line ${index + 1}: Invalid format. Expected "{quantity}x {card number} [card name]"`);
      return;
    }

    const quantity = parseInt(match[1], 10);
    const cardNumber = match[2].trim();
    const cardName = match[3] ? match[3].trim() : '';

    if (isNaN(quantity) || quantity < 0) {
      errors.push(`Line ${index + 1}: Invalid quantity "${match[1]}"`);
      return;
    }

    cardNumbersToFind.add(cardNumber);
    parsed.push({ quantity, cardNumber, cardName, lineIndex: index + 1 });
  });

  return { parsed, errors, cardNumbersToFind };
};

/**
 * Match products to parsed import lines
 * @param {Array} parsedLines - Parsed import lines
 * @param {Object} cardNumberToProducts - Map of card numbers to products
 * @returns {Object} Object with importedItems map, errors, and warnings
 */
export const matchProductsToImportLines = (parsedLines, cardNumberToProducts) => {
  const importedItems = {}; // { productId: quantity }
  const errors = [];
  const warnings = [];

  parsedLines.forEach(({ quantity, cardNumber, cardName, lineIndex }) => {
    const productsWithPrices = cardNumberToProducts[cardNumber];
    if (!productsWithPrices || productsWithPrices.length === 0) {
      warnings.push(`Line ${lineIndex}: Card number "${cardNumber}" not found in category`);
      return;
    }

    // Select product: if multiple, try to match by name first, otherwise use lowest price
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
      importedItems[productId] = quantity;
    }
  });

  return { importedItems, errors, warnings };
};

