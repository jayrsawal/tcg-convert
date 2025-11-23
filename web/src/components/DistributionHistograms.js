import React from 'react';
import './DistributionHistograms.css';

/**
 * Shared component for distribution histograms in sidebars
 * Used by both DeckBuilderPage and ProductsPage
 * 
 * @param {Object} props
 * @param {string} props.histogramTab - Active tab ('cost', 'level', 'cardType', 'market')
 * @param {Function} props.setHistogramTab - Function to change active tab
 * @param {boolean} props.histogramsMinimized - Whether histograms are minimized
 * @param {Function} props.setHistogramsMinimized - Function to toggle minimize
 * @param {boolean} props.histogramsExpanded - Whether all histograms are shown (deck builder only)
 * @param {Function} props.setHistogramsExpanded - Function to toggle expand (deck builder only)
 * @param {Object} props.costFrequency - Frequency data for cost histogram
 * @param {Object} props.levelFrequency - Frequency data for level histogram
 * @param {Object} props.cardTypeFrequency - Frequency data for card type histogram
 * @param {Array} props.valueData - Market value data array
 * @param {Array} props.allCosts - All cost values to display
 * @param {Array} props.allLevels - All level values to display
 * @param {Array} props.sortedCardTypes - Card types in order
 * @param {number} props.totalCards - Total number of cards
 * @param {number} props.totalValue - Total market value
 * @param {number} props.maxPercentage - Max percentage for market histogram
 * @param {Function} props.setMaxPercentage - Function to set max percentage
 * @param {string} props.selectedCurrency - Selected currency ('usd', 'cad', 'eur')
 * @param {Function} props.setSelectedCurrency - Function to set currency
 * @param {boolean} props.loadingRates - Whether currency rates are loading
 * @param {boolean} props.currencyRates - Currency rates object
 * @param {Function} props.formatCurrency - Function to format currency
 * @param {Object} props.categoryRules - Category rules (for deck size limit)
 * @param {Array} props.availableTabs - Array of available tabs (e.g., ['cardType', 'market'] for inventory)
 */
const DistributionHistograms = ({
  histogramTab,
  setHistogramTab,
  histogramsMinimized,
  setHistogramsMinimized,
  histogramsExpanded,
  setHistogramsExpanded,
  costFrequency,
  levelFrequency,
  cardTypeFrequency,
  valueData,
  allCosts,
  allLevels,
  sortedCardTypes,
  totalCards,
  totalValue,
  maxPercentage,
  setMaxPercentage,
  selectedCurrency,
  setSelectedCurrency,
  loadingRates,
  currencyRates,
  formatCurrency,
  categoryRules,
  availableTabs = ['cost', 'level', 'cardType', 'market'] // Default: all tabs for deck builder
}) => {
  // Don't render if no cards
  if (totalCards === 0) {
    return null;
  }

  const renderHistogram = (data, allValues, getLabel, getTitle) => {
    const maxFrequency = Math.max(...Object.values(data), 1);
    
    return (
      <div className="distribution-histogram">
        {allValues.map(value => {
          const frequency = data[String(value)] || 0;
          const percentage = totalCards > 0 ? (frequency / totalCards) * 100 : 0;
          const barHeight = maxFrequency > 0 ? (frequency / maxFrequency) * 100 : 0;
          const hasCards = frequency > 0;
          
          return (
            <div key={value} className="distribution-histogram-bar-container">
              <div className="distribution-histogram-bar-wrapper">
                <div 
                  className={`distribution-histogram-bar ${hasCards ? 'has-cards' : 'no-cards'}`}
                  style={{ height: `${barHeight}%` }}
                  title={hasCards 
                    ? getTitle(value, frequency, percentage)
                    : getTitle(value, 0, 0)
                  }
                >
                  {hasCards && (
                    <span className="distribution-histogram-bar-value">{frequency}</span>
                  )}
                </div>
              </div>
              <div className="distribution-histogram-label">{getLabel(value)}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMarketHistogram = () => {
    const maxValue = valueData.length > 0 ? valueData[0].value : 0;
    
    return (
      <div className="distribution-histogram-value-container">
        <div className="distribution-histogram">
          {valueData.map(({ percentage, value }) => {
            const barHeight = maxValue > 0 ? (value / maxValue) * 100 : 0;
            const formattedValue = formatCurrency(value);
            
            return (
              <div key={percentage} className="distribution-histogram-bar-container">
                <div className="distribution-histogram-bar-wrapper">
                  <div 
                    className="distribution-histogram-bar has-cards"
                    style={{ height: `${barHeight}%` }}
                    title={`${percentage}% of total value: ${formattedValue}`}
                  >
                    <span className="distribution-histogram-bar-value">{formattedValue}</span>
                  </div>
                </div>
                <div className="distribution-histogram-label">{percentage}%</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="distribution-histogram-container">
      <div className="distribution-histogram-header">
        <div className="distribution-histogram-tabs">
          {availableTabs.includes('cost') && (
            <button
              className={`distribution-tab ${histogramTab === 'cost' ? 'active' : ''}`}
              onClick={() => setHistogramTab('cost')}
            >
              Cost
            </button>
          )}
          {availableTabs.includes('level') && (
            <button
              className={`distribution-tab ${histogramTab === 'level' ? 'active' : ''}`}
              onClick={() => setHistogramTab('level')}
            >
              Level
            </button>
          )}
          {availableTabs.includes('cardType') && (
            <button
              className={`distribution-tab ${histogramTab === 'cardType' ? 'active' : ''}`}
              onClick={() => setHistogramTab('cardType')}
            >
              Card Type
            </button>
          )}
          {(availableTabs.includes('market') || availableTabs.includes('value')) && (
            <button
              className={`distribution-tab ${(histogramTab === 'market' || histogramTab === 'value') ? 'active' : ''}`}
              onClick={() => setHistogramTab(availableTabs.includes('market') ? 'market' : 'value')}
            >
              Market
            </button>
          )}
        </div>
        <div className="distribution-histogram-header-actions">
          {setHistogramsExpanded && (
            <button
              className="distribution-histogram-expand-toggle"
              onClick={() => setHistogramsExpanded(!histogramsExpanded)}
              title={histogramsExpanded ? 'Show single histogram' : 'Show all histograms'}
              aria-label={histogramsExpanded ? 'Show single' : 'Show all'}
            >
              {histogramsExpanded ? '⊟' : '⊞'}
            </button>
          )}
          <button
            className="distribution-histogram-toggle"
            onClick={() => setHistogramsMinimized(!histogramsMinimized)}
            title={histogramsMinimized ? 'Expand histograms' : 'Minimize histograms'}
            aria-label={histogramsMinimized ? 'Expand' : 'Minimize'}
          >
            {histogramsMinimized ? '▼' : '▲'}
          </button>
        </div>
      </div>
      
      {!histogramsMinimized && (
        <div className="distribution-histogram-content">
          {histogramsExpanded && setHistogramsExpanded ? (
            // Show all histograms when expanded (deck builder only)
            <div className="distribution-histograms-expanded">
              {availableTabs.includes('cost') && (
                <div className="distribution-histogram-section">
                  <h4 className="distribution-histogram-section-title">Cost</h4>
                  {renderHistogram(
                    costFrequency,
                    allCosts,
                    (cost) => cost,
                    (cost, freq, pct) => `Cost ${cost}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
                  )}
                </div>
              )}
              
              {availableTabs.includes('level') && (
                <div className="distribution-histogram-section">
                  <h4 className="distribution-histogram-section-title">Level</h4>
                  {renderHistogram(
                    levelFrequency,
                    allLevels,
                    (level) => level,
                    (level, freq, pct) => `Level ${level}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
                  )}
                </div>
              )}
              
              {availableTabs.includes('cardType') && (
                <div className="distribution-histogram-section">
                  <h4 className="distribution-histogram-section-title">Card Type</h4>
                  {renderHistogram(
                    cardTypeFrequency,
                    sortedCardTypes,
                    (cardType) => cardType,
                    (cardType, freq, pct) => `${cardType}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
                  )}
                </div>
              )}
              
              {(availableTabs.includes('market') || availableTabs.includes('value')) && (
                <div className="distribution-histogram-section">
                  <h4 className="distribution-histogram-section-title">Market</h4>
                  {renderMarketHistogram()}
                </div>
              )}
            </div>
          ) : (
            // Show single histogram based on tab
            <>
              {histogramTab === 'cost' && availableTabs.includes('cost') && renderHistogram(
                costFrequency,
                allCosts,
                (cost) => cost,
                (cost, freq, pct) => `Cost ${cost}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
              )}
              
              {histogramTab === 'level' && availableTabs.includes('level') && renderHistogram(
                levelFrequency,
                allLevels,
                (level) => level,
                (level, freq, pct) => `Level ${level}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
              )}
              
              {histogramTab === 'cardType' && availableTabs.includes('cardType') && renderHistogram(
                cardTypeFrequency,
                sortedCardTypes,
                (cardType) => cardType,
                (cardType, freq, pct) => `${cardType}: ${freq} card${freq !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`
              )}
              
              {(histogramTab === 'market' || histogramTab === 'value') && (availableTabs.includes('market') || availableTabs.includes('value')) && renderMarketHistogram()}
            </>
          )}
        </div>
      )}
      
      {!histogramsMinimized && (
        <div className="distribution-histogram-footer">
          <span className={`distribution-histogram-total ${(() => {
            if (categoryRules?.deck_size && totalCards > categoryRules.deck_size) {
              return 'over-limit';
            }
            return '';
          })()}`}>
            Total: {totalCards} cards
            {categoryRules?.deck_size && totalCards > categoryRules.deck_size && (
              <span className="over-limit-badge" title={`Exceeds limit by ${totalCards - categoryRules.deck_size} card${totalCards - categoryRules.deck_size !== 1 ? 's' : ''}`}>
                {' '}(+{totalCards - categoryRules.deck_size})
              </span>
            )}
          </span>
          <span className="distribution-histogram-total">
            TCGPlayer Market: {formatCurrency(totalValue * (maxPercentage / 100))}
            {maxPercentage !== 100 && (
              <span className="max-percentage-indicator" title={`Showing ${maxPercentage}% of total market value`}>
                {' '}({maxPercentage}%)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export default DistributionHistograms;

