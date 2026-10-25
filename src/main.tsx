import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import SnipOverlay from './components/SnipOverlay';

// No browser context menu in the panel
document.addEventListener('contextmenu', (e) => e.preventDefault());

// The snip window (open_snip_window) loads the same page with #snip
const snipping = window.location.hash === '#snip';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {snipping ? <SnipOverlay /> : <App />}
  </StrictMode>,
);
