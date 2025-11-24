import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { fetchUserProfile } from '../lib/api';

const TCGPercentageContext = createContext();

export const useTCGPercentage = () => {
  const context = useContext(TCGPercentageContext);
  if (!context) {
    throw new Error('useTCGPercentage must be used within a TCGPercentageProvider');
  }
  return context;
};

export const TCGPercentageProvider = ({ children }) => {
  const { user } = useAuth();
  // Load TCG percentage from localStorage or default to 50
  const [selectedTCGPercentage, setSelectedTCGPercentage] = useState(() => {
    const saved = localStorage.getItem('selectedTCGPercentage');
    return saved ? parseInt(saved, 10) : 50;
  });

  const [profileTCGPercentageLoaded, setProfileTCGPercentageLoaded] = useState(false);

  // Load TCG percentage from user profile when user is authenticated
  useEffect(() => {
    const loadProfileTCGPercentage = async () => {
      if (user && !profileTCGPercentageLoaded) {
        try {
          const profile = await fetchUserProfile(user.id);
          if (profile && profile.tcg_percentage !== undefined && profile.tcg_percentage !== null) {
            const profileTCGPercentage = parseInt(profile.tcg_percentage, 10);
            // Only update if it's a valid number
            if (!isNaN(profileTCGPercentage)) {
              setSelectedTCGPercentage(profileTCGPercentage);
            } else {
              // If profile value is invalid, default to 100
              setSelectedTCGPercentage(100);
            }
          } else {
            // If profile doesn't have tcg_percentage (NULL/undefined), default to 100
            setSelectedTCGPercentage(100);
          }
          setProfileTCGPercentageLoaded(true);
        } catch (err) {
          console.error('Error loading profile TCG percentage:', err);
          // On error, default to 100
          setSelectedTCGPercentage(100);
          setProfileTCGPercentageLoaded(true);
        }
      } else if (!user) {
        // Reset when user logs out
        setProfileTCGPercentageLoaded(false);
      }
    };

    loadProfileTCGPercentage();
  }, [user, profileTCGPercentageLoaded]);

  // Save TCG percentage to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('selectedTCGPercentage', selectedTCGPercentage.toString());
  }, [selectedTCGPercentage]);

  const value = {
    selectedTCGPercentage,
    setSelectedTCGPercentage,
  };

  return (
    <TCGPercentageContext.Provider value={value}>
      {children}
    </TCGPercentageContext.Provider>
  );
};
