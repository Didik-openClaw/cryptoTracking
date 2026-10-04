import { Observable } from './observable';
import { load, save } from './storage';

export interface Settings {
  /** Minimum position notional (USD) shown as a "jumbo" whale position. */
  minPositionUsd: number;
  /** How many leaderboard accounts (largest account value first) to scan. */
  scanLimit: number;
  /** Skip leaderboard accounts below this account value. */
  minAccountValue: number;
  /** REST weight budget per minute (Hyperliquid limit is 1200/IP). */
  rateBudget: number;
  continuousScan: boolean;
  /** Re-check wallets that already hold whale positions every N seconds. */
  hotRefreshSec: number;

  liveMinUsd: number;
  liveTopCoins: number;
  liveSound: boolean;

  watchPollSec: number;
  alertSizeChangePct: number;
  alertLiqPct: number;
  alertTrades: boolean;
  alertPositionChanges: boolean;
  alertNewWhale: boolean;
  alertNewWhaleMinUsd: number;
  alertSound: boolean;
  browserNotifications: boolean;

  /** Optional CoinDesk Data / CryptoCompare key for the news panel (higher rate limits). */
  newsApiKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  minPositionUsd: 5_000_000,
  scanLimit: 1500,
  minAccountValue: 100_000,
  rateBudget: 800,
  continuousScan: true,
  hotRefreshSec: 60,

  liveMinUsd: 1_000_000,
  liveTopCoins: 80,
  liveSound: false,

  watchPollSec: 20,
  alertSizeChangePct: 10,
  alertLiqPct: 5,
  alertTrades: true,
  alertPositionChanges: true,
  alertNewWhale: false,
  alertNewWhaleMinUsd: 10_000_000,
  alertSound: true,
  browserNotifications: true,

  newsApiKey: '',
};

class SettingsStore extends Observable {
  value: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) };

  constructor() {
    super(0);
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    save('settings', this.value);
    this.emit(true);
  }

  reset(): void {
    this.value = { ...DEFAULT_SETTINGS };
    save('settings', this.value);
    this.emit(true);
  }
}

export const settings = new SettingsStore();
