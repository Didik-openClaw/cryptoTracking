import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { theme } from '../lib/theme';
import { BuyPage } from './BuyPage';
import '../styles.css';

theme.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuyPage />
  </StrictMode>,
);
