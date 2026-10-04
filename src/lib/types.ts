// Response shapes of the public Hyperliquid API (https://api.hyperliquid.xyz/info).
// Numeric values arrive as strings; they are parsed where they are used.

export type Side = 'long' | 'short';

export interface HLLeverage {
  type: 'cross' | 'isolated';
  value: number;
  rawUsd?: string;
}

export interface HLPosition {
  coin: string;
  szi: string;
  entryPx: string | null;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  leverage: HLLeverage;
  marginUsed: string;
  maxLeverage?: number;
  cumFunding?: { allTime: string; sinceOpen: string; sinceChange: string };
}

export interface HLMarginSummary {
  accountValue: string;
  totalNtlPos: string;
  totalRawUsd: string;
  totalMarginUsed: string;
}

export interface HLClearinghouseState {
  assetPositions: { position: HLPosition; type: string }[];
  marginSummary: HLMarginSummary;
  crossMarginSummary: HLMarginSummary;
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  time: number;
}

export interface HLAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
}

export interface HLAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
}

export type HLMetaAndAssetCtxs = [{ universe: HLAssetMeta[] }, HLAssetCtx[]];

export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: 'A' | 'B';
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken?: string;
  tid: number;
  liquidation?: { liquidatedUser?: string; markPx: string; method: string };
}

export interface HLOpenOrder {
  coin: string;
  side: 'A' | 'B';
  limitPx: string;
  sz: string;
  origSz?: string;
  oid: number;
  timestamp: number;
  orderType?: string;
  triggerPx?: string;
  isTrigger?: boolean;
  triggerCondition?: string;
  reduceOnly?: boolean;
  isPositionTpsl?: boolean;
  tif?: string | null;
}

export interface HLFundingEntry {
  time: number;
  hash: string;
  delta: { type: 'funding'; coin: string; usdc: string; szi: string; fundingRate: string };
}

export interface HLLedgerEntry {
  time: number;
  hash: string;
  delta: { type: string; usdc?: string; [k: string]: unknown };
}

export type HLPortfolioWindow = 'day' | 'week' | 'month' | 'allTime' | 'perpDay' | 'perpWeek' | 'perpMonth' | 'perpAllTime';

export interface HLPortfolioData {
  accountValueHistory: [number, string][];
  pnlHistory: [number, string][];
  vlm: string;
}

export type HLPortfolio = [HLPortfolioWindow, HLPortfolioData][];

export interface HLSpotBalance {
  coin: string;
  token: number;
  total: string;
  hold: string;
  entryNtl: string;
}

export interface HLCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

export interface HLWsTrade {
  coin: string;
  side: 'A' | 'B';
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
  users: [string, string];
}

// ---- Normalised app-level models ----

export interface Position {
  coin: string;
  side: Side;
  size: number; // absolute size in coin units
  szi: number; // signed size
  entryPx: number;
  positionValue: number; // notional at the mark price of the snapshot
  unrealizedPnl: number;
  roe: number;
  liquidationPx: number | null;
  leverage: number;
  leverageType: 'cross' | 'isolated';
  marginUsed: number;
  fundingSinceOpen: number; // positive = the trader received funding
}

export interface WalletSnapshot {
  address: string;
  accountValue: number;
  totalNtlPos: number;
  marginUsed: number;
  withdrawable: number;
  positions: Position[];
  updatedAt: number;
}

export interface SeedAccount {
  address: string;
  accountValue: number;
  displayName: string | null;
  pnlDay: number;
  pnlWeek: number;
  pnlMonth: number;
  pnlAllTime: number;
  vlmMonth: number;
}

/** A wallet position enriched with live mark data for display. */
export interface LivePosition extends Position {
  address: string;
  mark: number;
  notional: number;
  livePnl: number;
  liveRoe: number;
  liqDistance: number | null; // fraction of mark price, e.g. 0.05 = 5% away
  accountValue: number;
  updatedAt: number;
}
