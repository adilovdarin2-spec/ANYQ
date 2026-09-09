import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { registerOfflineSupport } from './offline';
import './styles/tokens.css';
import './styles/global.css';

// Registered through a module that remembers how it went. Swallowing the failure
// meant a till could lose its offline promise silently and only find out on the
// morning the line dropped — see offline.ts.
window.addEventListener('load', registerOfflineSupport);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
