import React from 'react';
import { createRoot } from 'react-dom/client';
import './base.css';
import './sonic.css';
import App from './Root.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);
