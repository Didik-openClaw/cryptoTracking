import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { theme } from '../lib/theme';
import { AdminPage } from './AdminPage';
import '../styles.css';

theme.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminPage />
  </StrictMode>,
);
