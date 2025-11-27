import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const defaultBgLogo = `${process.env.PUBLIC_URL || ''}/strikerpack-1.png`;
document.documentElement.style.setProperty('--app-bg-logo', `url(${defaultBgLogo})`);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

