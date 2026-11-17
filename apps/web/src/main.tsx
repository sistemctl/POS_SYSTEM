import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { instalarCapturaErrores } from './lib/logs';
import './index.css';

instalarCapturaErrores();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
