import React, { useState, useEffect } from 'react';
import './ExportDeckModal.css';

const ExportDeckModal = ({ 
  isOpen, 
  onClose, 
  deckName, 
  deckItems, 
  deckProducts, 
  onImport, 
  onRemove,
  canEdit = false, 
  isImporting = false, 
  showPrepopulate = true, 
  showMSAButton = true, 
  showCopyButton = true 
}) => {
  const [exportText, setExportText] = useState('');
  const [originalExportText, setOriginalExportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [mobileSuitArenaUrl, setMobileSuitArenaUrl] = useState('');

  // Reset text to original when modal closes (discard changes)
  useEffect(() => {
    if (!isOpen) {
      setExportText(originalExportText);
    }
  }, [isOpen, originalExportText]);

  useEffect(() => {
    if (isOpen && deckItems && deckProducts && showPrepopulate) {
      const lines = [];
      
      // Sort products by number for consistent output
      const sortedProducts = [...deckProducts].sort((a, b) => {
        const aNum = a.Number || a.number || '';
        const bNum = b.Number || b.number || '';
        const aNumInt = parseInt(aNum, 10);
        const bNumInt = parseInt(bNum, 10);
        
        if (!isNaN(aNumInt) && !isNaN(bNumInt)) {
          return aNumInt - bNumInt;
        }
        return aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' });
      });

      sortedProducts.forEach(product => {
        const productId = String(product.product_id || product.id);
        const quantity = deckItems[productId] || 0;
        
        if (quantity > 0) {
          const number = product.Number || product.number || '';
          const name = product.name || product.product_name || '';
          lines.push(`${quantity}x ${number} ${name}`);
        }
      });

      const text = lines.join('\n');
      setExportText(text);
      setOriginalExportText(text);
    } else if (isOpen && !showPrepopulate) {
      setExportText('');
      setOriginalExportText('');
      setMobileSuitArenaUrl('');
    }
  }, [isOpen, deckItems, deckProducts, showPrepopulate]);

  useEffect(() => {
    if (isOpen && deckItems && deckProducts && showMSAButton) {
      const cardList = [];
      
      deckProducts.forEach(product => {
        const productId = String(product.product_id || product.id);
        const quantity = deckItems[productId] || 0;
        
        if (quantity > 0) {
          const number = product.Number || product.number || '';
          cardList.push(`${number}:${quantity}`);
        }
      });

      if (cardList.length > 0) {
        const cardsParam = cardList.join(',');
        const url = `https://mobilesuitarena.com/?decklist=${encodeURIComponent(cardsParam)}&type=gundam`;
        setMobileSuitArenaUrl(url);
      } else {
        setMobileSuitArenaUrl('');
      }
    } else if (isOpen && !showMSAButton) {
      setMobileSuitArenaUrl('');
    }
  }, [isOpen, deckItems, deckProducts, showMSAButton]);

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleImport = async () => {
    if (onImport && exportText.trim()) {
      await onImport(exportText);
      onClose();
    }
  };

  const handleRemove = async () => {
    if (onRemove && exportText.trim()) {
      await onRemove(exportText);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="export-deck-overlay" onClick={onClose} />
      <div className="export-deck-modal">
        <div className="export-deck-header">
          <h3 className="export-deck-title">Import/Export: {deckName || 'Untitled'}</h3>
          <button className="export-deck-close" onClick={onClose} aria-label="Close export modal">×</button>
        </div>
        <div className="export-deck-content">
          <div className="export-deck-textbox-container">
            <textarea
              className="export-deck-textbox"
              value={exportText}
              readOnly={false}
              rows={15}
              onChange={(e) => setExportText(e.target.value)}
              placeholder={showPrepopulate 
                ? "Deck list will appear here. You can edit it to import a different deck list.\nFormat: {quantity}x {card number} {card name}\nExample:\n3x 001 Card Name\n2x 002 Another Card" 
                : "Paste or type your inventory list here.\nFormat: {quantity}x {card number} [card name]\nExample:\n3x 001 Card Name\n2x 002 Another Card\n\nNote: Import is additive. Remove is subtractive."}
            />
          </div>
          <div className="export-deck-actions">
            {showMSAButton && mobileSuitArenaUrl && (
              <a
                href={mobileSuitArenaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="export-deck-msa-button"
              >
                Load in Mobile Suit Arena
              </a>
            )}
            {canEdit && onImport && (
              <button
                className="export-deck-import-button"
                onClick={handleImport}
                disabled={!exportText.trim() || isImporting}
              >
                {isImporting ? 'Importing...' : (showPrepopulate ? 'Import Deck' : 'Import to Inventory')}
              </button>
            )}
            {canEdit && onRemove && (
              <button
                className="export-deck-remove-button"
                onClick={handleRemove}
                disabled={!exportText.trim() || isImporting}
              >
                {isImporting ? 'Removing...' : 'Remove from Inventory'}
              </button>
            )}
            {showCopyButton && (
              <button
                className="export-deck-copy-button"
                onClick={handleCopyToClipboard}
                disabled={!exportText}
              >
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ExportDeckModal;

