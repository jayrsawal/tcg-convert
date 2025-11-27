/**
 * Convert hex color to RGB
 * @param {string} hex - Hex color string (e.g., '#C08537')
 * @returns {Object} Object with r, g, b values
 */
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

/**
 * Calculate relative luminance of a color
 * @param {string} hex - Hex color string
 * @returns {number} Luminance value (0-1)
 */
const getLuminance = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5; // Default to medium if invalid
  
  // Convert RGB to relative luminance
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(val => {
    val = val / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Determine if a color is dark (needs light text) or light (needs dark text)
 * @param {string} hex - Hex color string
 * @returns {string} Text color ('#ffffff' for dark backgrounds, '#000000' for light)
 */
const getTextColor = (hex) => {
  const luminance = getLuminance(hex);
  // If luminance is less than 0.5, it's dark, use light text
  return luminance < 0.5 ? '#ffffff' : '#000000';
};

/**
 * Format description text with keyword highlighting
 * Keywords between [] or <> are highlighted based on their starting text
 * Keywords between () are highlighted with default color (only if not inside [] or <>)
 * 
 * @param {string} text - The description text to format
 * @returns {string} - HTML string with highlighted keywords
 */
export const formatDescription = (text) => {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  // Keyword color mapping (starts_with > color) - case insensitive matching
  const keywordColors = {
    'Burst': '#C08537',
    'Activate': '#6BA9E6',
    'Support': '#FFF',
    'Breach': '#FFF',
    'Blocker': '#FFF',
    'Repair': '#FFF',
    'Suppression': '#FFF',
    'High Maneuver': '#FFF',
    'During Pair': '#CB699C',
    'When Paired': '#CB699C',
    'While Paired': '#CB699C',
    'Once Per Turn': '#9D151F',
    'During Link': '#EEF04F',
    'When Linked': '#EEF04F',
    'While Linked': '#EEF04F',
    'Deploy': '#7EB3B9',
    'Destroyed': '#7EB3B9',
    'Attack': '#7EB3B9',
  };

  // Sort keywords by length (longest first) to match longer phrases first
  const sortedKeywords = Object.keys(keywordColors).sort((a, b) => b.length - a.length);

  // First, normalize line breaks: convert \n to <br> and collapse consecutive <br> tags
  // This handles cases where descriptions contain both <br> tags and newline characters
  // Also handles <br> tags separated by whitespace/newlines
  let formatted = text.replace(/\n/g, '<br>');
  // Collapse <br> tags that might be separated by whitespace (including other <br> tags)
  formatted = formatted.replace(/(<br\s*\/?>[\s\n]*)+/gi, '<br>');
  
  const replacements = [];
  let replacementIndex = 0;

  // Process square brackets [] first - use placeholders to avoid matching HTML we create
  formatted = formatted.replace(/\[([^\]]+)\]/g, (match, keyword) => {
    // Find matching color based on keyword start (case insensitive, starts with)
    let color = null;
    const trimmedKeyword = keyword.trim();
    for (const key of sortedKeywords) {
      if (trimmedKeyword.toLowerCase().startsWith(key.toLowerCase())) {
        color = keywordColors[key];
        break;
      }
    }
    
    // Default color if no match
    if (!color) {
      color = '#FFF';
    }

    // Get appropriate text color based on background brightness
    const textColor = getTextColor(color);

    // Store replacement HTML
    const placeholder = `__SQUARE_BRACKET_${replacementIndex}__`;
    replacements.push({
      placeholder,
      html: `<span class="description-keyword description-keyword-square" style="background-color: ${color}; color: ${textColor}; border-color: ${color};"> ${keyword} </span>`
    });
    replacementIndex++;
    return placeholder;
  });

  // Process angle brackets <> - use placeholders to avoid matching HTML we create
  formatted = formatted.replace(/<([^<>]+)>/g, (match, keyword) => {
    const trimmedKeyword = keyword.trim();
    
    // Skip if this looks like an HTML tag:
    // - Contains quotes (attribute values)
    // - Contains equals signs (attributes)
    // - Starts with / (closing tag)
    // - Is a single word starting with a letter (like <span>, <div>, etc.)
    if (trimmedKeyword.includes('"') || 
        trimmedKeyword.includes("'") || 
        trimmedKeyword.includes('=') ||
        trimmedKeyword.startsWith('/') ||
        (/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmedKeyword) && !/\s/.test(trimmedKeyword))) {
      return match; // Don't replace, keep original
    }

    // Find matching color based on keyword start (case insensitive, starts with)
    let color = null;
    for (const key of sortedKeywords) {
      if (trimmedKeyword.toLowerCase().startsWith(key.toLowerCase())) {
        color = keywordColors[key];
        break;
      }
    }
    
    // Default color if no match
    if (!color) {
      color = '#FFF'; // Default color
    }

    // Get appropriate text color based on background brightness
    const textColor = getTextColor(color);

    // Store replacement HTML
    const placeholder = `__ANGLE_BRACKET_${replacementIndex}__`;
    replacements.push({
      placeholder,
      html: `<span class="description-keyword description-keyword-rounded" style="background-color: ${color}; color: ${textColor}; border-color: ${color};"> ${keyword} </span>`
    });
    replacementIndex++;
    return placeholder;
  });

  // Process parentheses () - only if not already inside [] or <>
  // Since we've already replaced [] and <> with placeholders, we can safely process ()
  // Only match if the content is an integer
  formatted = formatted.replace(/\(([^)]+)\)/g, (match, keyword) => {
    const trimmedKeyword = keyword.trim();
    
    // Only match if the content is an integer (positive or negative)
    if (!/^-?\d+$/.test(trimmedKeyword)) {
      return match; // Don't replace, keep original
    }

    // Use default color for parentheses keywords
    const color = '#FFF';
    const textColor = getTextColor(color);

    // Store replacement HTML with fully rounded borders
    const placeholder = `__PARENTHESES_${replacementIndex}__`;
    replacements.push({
      placeholder,
      html: `<span class="description-keyword description-keyword-fully-rounded" style="background-color: ${color}; color: ${textColor}; border-color: ${color};">${keyword}</span>`
    });
    replacementIndex++;
    return placeholder;
  });

  // Now apply all replacements (this converts placeholders to actual HTML)
  replacements.forEach(({ placeholder, html }) => {
    formatted = formatted.replace(placeholder, html);
  });

  // Final collapse of consecutive <br> tags (in case replacements created any)
  // Also handles <br> tags separated by whitespace
  formatted = formatted.replace(/(<br\s*\/?>[\s\n]*)+/gi, '<br>');

  return formatted;
};

