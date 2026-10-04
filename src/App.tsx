import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { CoinPage } from './pages/CoinPage';
import { CoinsPage } from './pages/CoinsPage';
import { LivePage } from './pages/LivePage';
import { ScannerPage } from './pages/ScannerPage';
import { SettingsPage } from './pages/SettingsPage';
import { WalletPage } from './pages/WalletPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { mode } from './lib/mode';
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
        {mode.demo && (
          <div className="demo-banner">
            <b>MODE DEMO</b> · Semua angka, wallet, dan trade di layar ini <b>simulasi</b>, bukan data Hyperliquid asli. Versi
            live mengambil data langsung dari API Hyperliquid setelah website di-deploy.
          </div>
        )}
        {content}
      </main>
      <StatusBar />
      <Toasts />
    </>
  );
}
