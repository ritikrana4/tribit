import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// ?wails=1 is appended by app.go when navigating in the desktop webview.
// Runs synchronously before React renders so CSS applies from the first paint.
if (new URLSearchParams(window.location.search).get('wails') === '1') {
  document.documentElement.setAttribute('data-wails', '');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
