import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Bundled type, so the app looks the same offline and on every OS:
// Manrope for the chrome, Inter for notes, JetBrains Mono for code.
import '@fontsource-variable/manrope';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
