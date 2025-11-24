import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { TCGPercentageProvider } from './contexts/TCGPercentageContext';
import LandingPage from './components/LandingPage';
import ProductsPage from './components/ProductsPage';
import DeckBuilderPage from './components/DeckBuilderPage';
import DeckListsPage from './components/DeckListsPage';
import ProductCardPage from './components/ProductCardPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import ProfilePage from './components/ProfilePage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <TCGPercentageProvider>
          <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/inventory" element={<ProductsPage />} />
            <Route path="/categories/:categoryId/products" element={<Navigate to="/inventory" replace />} />
            <Route path="/deck-builder/:deckListId" element={<DeckBuilderPage />} />
            <Route path="/deck-lists" element={<DeckListsPage />} />
            <Route path="/products/:productId" element={<ProductCardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
        </TCGPercentageProvider>
      </CurrencyProvider>
    </AuthProvider>
  );
}

export default App;

