import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LangRoot } from '../lib/i18n';
import { theme } from '../lib/theme';
import { BuyPage } from './BuyPage';
import '../styles.css';

theme.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangRoot>
      <BuyPage />
    </LangRoot>
  </StrictMode>,
);
