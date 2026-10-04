import { Header } from './components/Header';
import { Toasts } from './components/Toasts';
import { CoinPage } from './pages/CoinPage';
import { CoinsPage } from './pages/CoinsPage';
import { LivePage } from './pages/LivePage';
import { ScannerPage } from './pages/ScannerPage';
import { SettingsPage } from './pages/SettingsPage';
import { WalletPage } from './pages/WalletPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const [page, arg] = route;

  let content;
  switch (page) {
    case 'coins':
      content = <CoinsPage />;
      break;
    case 'coin':
      content = arg ? <CoinPage key={arg} coin={arg} /> : <CoinsPage />;
      break;
    case 'live':
      content = <LivePage />;
      break;
    case 'wallet':
      content = <WalletPage address={arg ?? ''} />;
      break;
    case 'watchlist':
      content = <WatchlistPage />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
    default:
      content = <ScannerPage />;
  }

  return (
    <>
      <Header route={route} />
      <main>
        {content}
        <div className="footer">
          Data publik dari API Hyperliquid (api.hyperliquid.xyz) · Bukan saran finansial · Chart oleh{' '}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts
          </a>
        </div>
      </main>
      <Toasts />
    </>
  );
}
