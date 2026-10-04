import { tr } from './i18n';
import { WeightLimiter } from './rateLimiter';
import { sleep } from './observable';
import type {
  HLCandle,
  HLClearinghouseState,
  HLFill,
  HLFundingEntry,
  HLLedgerEntry,
  HLMetaAndAssetCtxs,
  HLOpenOrder,
  HLPortfolio,
  HLSpotBalance,
} from './types';

export const INFO_URL = 'https://api.hyperliquid.xyz/info';
export const WS_URL = 'wss://api.hyperliquid.xyz/ws';
export const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

/**
 * Request priority: a page the user opened beats batch lookups for a list
 * (Top Whale stats) beats watchlist polling beats the background scan.
 */
export const Priority = { Scan: 0, Watch: 1, Bulk: 2, User: 3 } as const;

// Shared budget for every REST call the app makes. The default rate leaves
// headroom below the 1200/min limit; the scanner never dips into the last 200
// tokens, which stay available as an instant burst for user actions.
export const limiter = new WeightLimiter(800, { capacity: 320, reserve: 200 });

export const apiStats = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  lastError: '' as string,
  lastErrorAt: 0,
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

interface InfoOpts {
  weight?: number;
  /** Weight Hyperliquid adds per `perItems` items in an array response (charged after it arrives). */
  perItems?: number;
  priority?: number;
  signal?: AbortSignal;
}

export async function info<T>(body: Record<string, unknown>, opts: InfoOpts = {}): Promise<T> {
  const weight = opts.weight ?? 20;
  const priority = opts.priority ?? Priority.User;
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire(weight, priority);
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: Response;
    try {
      apiStats.requests++;
      res = await fetch(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const why = (e as Error).message;
      throw fail(new ApiError(tr(`Gagal terhubung ke API Hyperliquid (${why})`, `Can't reach the Hyperliquid API (${why})`)));
    }
    if (res.status === 429) {
      apiStats.rateLimited++;
      limiter.pause(5_000 * (attempt + 1));
      if (attempt < 5) continue;
      throw fail(
        new ApiError(
          tr(
            'Kena rate limit Hyperliquid (429). Turunkan kecepatan scan di Pengaturan.',
            'Hyperliquid rate limit hit (429). Lower the scan rate in Settings.',
          ),
          429,
        ),
      );
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw fail(new ApiError(tr(`API Hyperliquid error ${res.status}`, `Hyperliquid API error ${res.status}`), res.status));
    }
    const json = (await res.json()) as T;
    if (opts.perItems && Array.isArray(json)) limiter.charge(Math.floor(json.length / opts.perItems));
    return json;
  }
}

function fail(e: ApiError): ApiError {
  apiStats.errors++;
  apiStats.lastError = e.message;
  apiStats.lastErrorAt = Date.now();
  return e;
}

// ---- Typed endpoints (weights from the Hyperliquid rate-limit docs) ----

export const getMetaAndAssetCtxs = () =>
  info<HLMetaAndAssetCtxs>({ type: 'metaAndAssetCtxs' }, { weight: 20, priority: Priority.Watch });

export const getAllMids = () => info<Record<string, string>>({ type: 'allMids' }, { weight: 2, priority: Priority.Watch });

export const getClearinghouseState = (user: string, priority: number = Priority.User, signal?: AbortSignal) =>
  info<HLClearinghouseState>({ type: 'clearinghouseState', user }, { weight: 2, priority, signal });

export const getSpotState = (user: string, signal?: AbortSignal) =>
  info<{ balances: HLSpotBalance[] }>({ type: 'spotClearinghouseState', user }, { weight: 2, signal });

export const getOpenOrders = (user: string, signal?: AbortSignal) =>
  info<HLOpenOrder[]>({ type: 'frontendOpenOrders', user }, { weight: 20, signal });

// userFills returns up to the 2000 most recent fills: weight 20 plus 1 per 20 fills returned.
export const getUserFills = (user: string, signal?: AbortSignal, priority: number = Priority.User) =>
  info<HLFill[]>({ type: 'userFills', user, aggregateByTime: true }, { weight: 20, perItems: 20, signal, priority });

/** userFills never returns more than this many fills. */
export const USER_FILLS_CAP = 2000;

export const getPortfolio = (user: string, signal?: AbortSignal) =>
  info<HLPortfolio>({ type: 'portfolio', user }, { weight: 20, signal });

const FUNDING_PAGE = 500;

/**
 * userFunding returns at most 500 entries counted from `startTime` forward,
 * so a whale holding several positions fills a page within days. Page forward
 * until the present (bounded by `maxPages`).
 */
export async function getUserFunding(user: string, startTime: number, signal?: AbortSignal, maxPages = 6) {
  const out: HLFundingEntry[] = [];
  let from = startTime;
  for (let page = 0; page < maxPages; page++) {
    const batch = await info<HLFundingEntry[]>({ type: 'userFunding', user, startTime: from }, { weight: 20, perItems: 20, signal });
    out.push(...batch);
    if (batch.length < FUNDING_PAGE) break;
    from = Math.max(...batch.map((e) => e.time)) + 1;
  }
  return out;
}

export const getLedger = (user: string, startTime: number, signal?: AbortSignal) =>
  info<HLLedgerEntry[]>({ type: 'userNonFundingLedgerUpdates', user, startTime }, { weight: 20, signal });

export const getCandles = (coin: string, interval: string, startTime: number, endTime: number, signal?: AbortSignal) =>
  info<HLCandle[]>(
    { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } },
    { weight: 20, perItems: 60, signal },
  );
