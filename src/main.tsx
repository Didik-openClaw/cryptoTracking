import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startApp } from './lib/app';
import { LangRoot } from './lib/i18n';
import { theme } from './lib/theme';
import './styles.css';

theme.start();
startApp();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangRoot>
      <App />
    </LangRoot>
  </StrictMode>,
);
