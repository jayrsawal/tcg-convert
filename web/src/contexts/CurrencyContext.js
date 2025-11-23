import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { fetchUserProfile } from '../lib/api';

const CurrencyContext = createContext();

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};

export const CurrencyProvider = ({ children }) => {
  const { user } = useAuth();
  // Load currency from localStorage or default to 'usd'
  const [selectedCurrency, setSelectedCurrency] = useState(() => {
    const saved = localStorage.getItem('selectedCurrency');
    return saved || 'usd';
  });

  const [currencyRates, setCurrencyRates] = useState(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [profileCurrencyLoaded, setProfileCurrencyLoaded] = useState(false);

  // Load currency from user profile when user is authenticated
  useEffect(() => {
    const loadProfileCurrency = async () => {
      if (user && !profileCurrencyLoaded) {
        try {
          const profile = await fetchUserProfile(user.id);
          if (profile && profile.currency) {
            const profileCurrency = profile.currency.toLowerCase();
            setSelectedCurrency(profileCurrency);
            setProfileCurrencyLoaded(true);
          } else {
            setProfileCurrencyLoaded(true);
          }
        } catch (err) {
          console.error('Error loading profile currency:', err);
          // Continue with localStorage/default currency
          setProfileCurrencyLoaded(true);
        }
      } else if (!user) {
        // Reset when user logs out
        setProfileCurrencyLoaded(false);
      }
    };

    loadProfileCurrency();
  }, [user, profileCurrencyLoaded]);

  // Save currency to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('selectedCurrency', selectedCurrency);
  }, [selectedCurrency]);

  // Fetch currency rates
  useEffect(() => {
    const fetchCurrencyRates = async () => {
      if (selectedCurrency === 'usd') {
        setCurrencyRates(null);
        return;
      }

      if (!currencyRates && !loadingRates) {
        setLoadingRates(true);
        try {
          const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json');
          if (!response.ok) {
            throw new Error('Failed to fetch currency rates');
          }
          const data = await response.json();
          setCurrencyRates(data.usd);
        } catch (err) {
          console.error('Error fetching currency rates:', err);
          setCurrencyRates(null);
        } finally {
          setLoadingRates(false);
        }
      }
    };

    fetchCurrencyRates();
  }, [selectedCurrency, currencyRates, loadingRates]);

  const value = {
    selectedCurrency,
    setSelectedCurrency,
    currencyRates,
    loadingRates
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};

