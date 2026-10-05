import { useEffect, useMemo, useState } from 'react';
import { PriceAlertPanel } from '../components/PriceAlertPanel';
import { Seg, StatCard } from '../components/ui';
import { fmtPct, fmtPx, fmtSize, fmtUsd, pnlClass, pxDecimals } from '../lib/format';
import { tr } from '../lib/i18n';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import {
  DEFAULT_MAKER_FEE,
  DEFAULT_TAKER_FEE,
  calculate,
  type CalcError,
  type CalcWarning,
  type MarginMode,
  type OrderType,
  type RiskMode,
  type TradeSide,
} from '../lib/riskCalc';
import { load, save } from '../lib/storage';

interface Form {
  coin: string;
  side: TradeSide;
  account: string;
  riskMode: RiskMode;
  risk: string;
  entry: string;
  stop: string;
  tps: { price: string; pct: string }[];
  leverage: string;
  marginMode: MarginMode;
  entryOrder: OrderType;
  tpOrder: OrderType;
  takerFee: string;
  makerFee: string;
  holdHours: string;
}

const DEFAULT_FORM: Form = {
  coin: 'BTC',
  side: 'long',
  account: '10000',
  riskMode: 'pct',
  risk: '1',
  entry: '',
  stop: '',
  tps: [
    { price: '', pct: '50' },
    { price: '', pct: '30' },
    { price: '', pct: '20' },
  ],
  leverage: '5',
  marginMode: 'isolated',
  entryOrder: 'market',
  tpOrder: 'limit',
  takerFee: String(DEFAULT_TAKER_FEE * 100),
  makerFee: String(DEFAULT_MAKER_FEE * 100),
  holdHours: '24',
};

const n = (s: string) => Number(String(s).replace(',', '.'));
const pxText = (v: number) => v.toFixed(Math.min(8, pxDecimals(v)));

const errorText = (e: CalcError) =>
  ({
    account: tr('Isi modal akun.', 'Enter the account size.'),
    risk: tr('Risiko harus > 0 dan tidak melebihi modal.', 'Risk must be > 0 and not more than the account.'),
    entry: tr('Isi harga entry.', 'Enter the entry price.'),
    stop: tr('Isi harga stop-loss.', 'Enter the stop-loss price.'),
    stopSide: tr('Stop-loss harus di bawah entry untuk long, di atas entry untuk short.', 'The stop-loss must be below entry for a long, above entry for a short.'),
    leverage: tr('Leverage di luar batas coin ini.', 'Leverage is outside this coin’s limit.'),
    sizeZero: tr('Ukuran posisi terlalu kecil untuk risiko ini.', 'Position size rounds to zero for this risk.'),
  })[e];

const warningText = (w: CalcWarning) =>
  ({
    stopBeyondLiq: tr('Stop-loss melewati harga likuidasi: posisi terlikuidasi sebelum stop kena. Turunkan leverage.', 'The stop is beyond the liquidation price: you get liquidated before the stop fills. Lower the leverage.'),
    marginOverAccount: tr('Margin melebihi modal akun: naikkan leverage atau kecilkan risiko.', 'Margin exceeds the account: raise leverage or lower the risk.'),
    belowMinOrder: tr('Nilai order di bawah minimum Hyperliquid ($10).', 'Order value is below Hyperliquid’s $10 minimum.'),
    tpWrongSide: tr('Ada take-profit di sisi rugi dari entry; diabaikan.', 'A take-profit is on the losing side of entry; ignored.'),
    tpOver100: tr('Persentase take-profit lebih dari 100%; dipotong.', 'Take-profit shares add up to more than 100%; capped.'),
    tpUnder100: tr('Sisa posisi ditutup di take-profit terakhir.', 'The rest of the position closes at the last take-profit.'),
    highRisk: tr('Risiko di atas 2% modal per trade.', 'Risk is above 2% of the account per trade.'),
    heavyFees: tr('Fee ≥ 20% dari kerugian di stop: stop terlalu dekat untuk ukuran ini.', 'Fees are ≥ 20% of the loss at the stop: the stop is very tight.'),
  })[w];

export function CalculatorPage({ coin: initialCoin }: { coin?: string }) {
  useObservable(market);
  const [f, setF] = useState<Form>(() => {
    const saved = load<Partial<Form>>('calc', {});
    return { ...DEFAULT_FORM, ...saved, ...(initialCoin ? { coin: initialCoin } : {}) };
  });
  useEffect(() => {
    save('calc', f);
  }, [f]);
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const info = market.coins.get(f.coin);
  const live = market.mids.get(f.coin) ?? info?.mark;
  const maxLev = info?.maxLeverage ?? 50;
  const coins = useMemo(() => market.topCoins(400).sort(), [market.coins.size]);

  const r = calculate({
    side: f.side,
    account: n(f.account),
    riskMode: f.riskMode,
    risk: n(f.risk),
    entry: n(f.entry),
    stop: n(f.stop),
    tps: f.tps.map((t) => ({ price: n(t.price) || 0, pct: n(t.pct) || 0 })),
    leverage: n(f.leverage),
    maxLeverage: maxLev,
    szDecimals: info?.szDecimals ?? 4,
    marginMode: f.marginMode,
    takerFee: n(f.takerFee) / 100,
    makerFee: n(f.makerFee) / 100,
    entryOrder: f.entryOrder,
    tpOrder: f.tpOrder,
    fundingRate: info?.funding ?? 0,
    holdHours: n(f.holdHours) || 0,
  });

  const field = (label: string, key: keyof Form, extra: { suffix?: string; wide?: boolean } = {}) => (
    <label className={`field${extra.wide ? ' grow' : ''}`}>
      <span>{label}</span>
      <div className="calc-input">
        <input className="input" inputMode="decimal" value={f[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} />
        {extra.suffix && <em>{extra.suffix}</em>}
      </div>
    </label>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">CALC</span>
            {tr('Kalkulator risiko & posisi', 'Risk & position calculator')}
          </h1>
          <p>
            {tr(
              'Ukuran posisi dari risiko yang Anda tentukan, termasuk fee, harga likuidasi, R:R tiap take-profit, dan biaya funding.',
              'Position size from the risk you choose, with fees, liquidation price, R:R per take-profit and funding cost.',
            )}
          </p>
        </div>
      </div>

      <div className="grid-2 calc">
        <section className="panel">
          <div className="panel-head">
            <h2>Input</h2>
            <button type="button" className="btn sm ghost" onClick={() => setF({ ...DEFAULT_FORM, coin: f.coin })}>
              Reset
            </button>
          </div>
          <div className="filters">
            <label className="field">
              <span>Coin</span>
              <select className="input" value={f.coin} onChange={(e) => set({ coin: e.target.value })}>
                {(coins.includes(f.coin) ? coins : [f.coin, ...coins]).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{tr('Arah', 'Side')}</span>
              <Seg<TradeSide>
                value={f.side}
                onChange={(side) => set({ side })}
                options={[
                  { value: 'long', label: 'Long', cls: 'long' },
                  { value: 'short', label: 'Short', cls: 'short' },
                ]}
              />
            </label>
            <span className="dim small">
              {live ? `${tr('Harga kini', 'Live')} ${fmtPx(live)}` : ''} · max {maxLev}× · funding {fmtPct(info?.funding ?? 0, { decimals: 4 })}/{tr('jam', 'h')}
            </span>
          </div>

          <div className="filters">
            {field(tr('Modal akun', 'Account size'), 'account', { suffix: 'USD' })}
            <label className="field">
              <span>{tr('Risiko per trade', 'Risk per trade')}</span>
              <div className="row" style={{ gap: 4 }}>
                <div className="calc-input">
                  <input className="input" inputMode="decimal" value={f.risk} onChange={(e) => set({ risk: e.target.value })} />
                </div>
                <Seg<RiskMode> value={f.riskMode} onChange={(riskMode) => set({ riskMode })} options={[{ value: 'pct', label: '%' }, { value: 'usd', label: 'USD' }]} />
              </div>
            </label>
          </div>

          <div className="filters">
            <label className="field">
              <span>Entry</span>
              <div className="row" style={{ gap: 4 }}>
                <div className="calc-input">
                  <input className="input" inputMode="decimal" value={f.entry} onChange={(e) => set({ entry: e.target.value })} placeholder={live ? pxText(live) : ''} />
                </div>
                <button type="button" className="btn sm ghost" disabled={!live} onClick={() => live && set({ entry: pxText(live) })}>
                  {tr('Harga kini', 'Live')}
                </button>
              </div>
            </label>
            {field('Stop-loss', 'stop')}
            <label className="field">
              <span>{tr('Order entry', 'Entry order')}</span>
              <Seg<OrderType> value={f.entryOrder} onChange={(entryOrder) => set({ entryOrder })} options={[{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }]} />
            </label>
          </div>

          <div className="calc-tps">
            {f.tps.map((t, i) => (
              <div key={i} className="filters">
                <label className="field">
                  <span>TP{i + 1}</span>
                  <div className="calc-input">
                    <input
                      className="input"
                      inputMode="decimal"
                      value={t.price}
                      onChange={(e) => set({ tps: f.tps.map((x, k) => (k === i ? { ...x, price: e.target.value } : x)) })}
                      placeholder={tr('opsional', 'optional')}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>{tr('% ditutup', '% closed')}</span>
                  <div className="calc-input sm">
                    <input
                      className="input"
                      inputMode="decimal"
                      value={t.pct}
                      onChange={(e) => set({ tps: f.tps.map((x, k) => (k === i ? { ...x, pct: e.target.value } : x)) })}
                    />
                    <em>%</em>
                  </div>
                </label>
                {r.ok && r.tps.find((x) => x.n === i + 1) && (
                  <span className="small calc-tp-r">
                    {(() => {
                      const x = r.tps.find((y) => y.n === i + 1)!;
                      return (
                        <>
                          <b>{x.r.toFixed(2)}R</b> · <span className="pos">{fmtUsd(x.pnl, { sign: true })}</span>{' '}
                          <span className="dim">({fmtPct(x.movePct, { sign: true })})</span>
                        </>
                      );
                    })()}
                  </span>
                )}
              </div>
            ))}
            <label className="field">
              <span>{tr('Order take-profit', 'Take-profit order')}</span>
              <Seg<OrderType> value={f.tpOrder} onChange={(tpOrder) => set({ tpOrder })} options={[{ value: 'limit', label: 'Limit' }, { value: 'market', label: 'Market' }]} />
            </label>
          </div>

          <div className="filters">
            <label className="field">
              <span>Leverage</span>
              <div className="row" style={{ gap: 6 }}>
                <input type="range" min={1} max={maxLev} value={Math.min(maxLev, n(f.leverage) || 1)} onChange={(e) => set({ leverage: e.target.value })} />
                <div className="calc-input sm">
                  <input className="input" inputMode="numeric" value={f.leverage} onChange={(e) => set({ leverage: e.target.value })} />
                  <em>×</em>
                </div>
              </div>
            </label>
            <label className="field">
              <span>Margin</span>
              <Seg<MarginMode> value={f.marginMode} onChange={(marginMode) => set({ marginMode })} options={[{ value: 'isolated', label: 'Isolated' }, { value: 'cross', label: 'Cross' }]} />
            </label>
          </div>
          <div className="filters">
            {field('Taker fee', 'takerFee', { suffix: '%' })}
            {field('Maker fee', 'makerFee', { suffix: '%' })}
            {field(tr('Lama pegang', 'Holding time'), 'holdHours', { suffix: tr('jam', 'h') })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{tr('Hasil', 'Result')}</h2>
            <span className={`hint ${f.side === 'long' ? 'pos' : 'neg'}`}>
              {f.side.toUpperCase()} {f.coin}
            </span>
          </div>
          {!r.ok ? (
            <ul className="calc-msgs danger">
              {r.errors.map((e) => (
                <li key={e}>{errorText(e)}</li>
              ))}
            </ul>
          ) : (
            <>
              <div className="cards calc-cards">
                <StatCard
                  label={tr('Ukuran posisi', 'Position size')}
                  value={`${fmtSize(r.size)} ${f.coin}`}
                  sub={tr(`nilai ${fmtUsd(r.notional)}`, `notional ${fmtUsd(r.notional)}`)}
                />
                <StatCard
                  label={tr('Rugi maksimal di stop', 'Max loss at stop')}
                  tone="short"
                  value={<span className="neg">{fmtUsd(-r.maxLoss)}</span>}
                  sub={tr(`${fmtPct(r.maxLossPctAccount)} modal · termasuk fee ${fmtUsd(r.feesAtStop)}`, `${fmtPct(r.maxLossPctAccount)} of account · incl. ${fmtUsd(r.feesAtStop)} fees`)}
                />
                <StatCard
                  label={tr('Profit di semua TP', 'Profit at all TPs')}
                  tone="long"
                  value={<span className={pnlClass(r.tpPnl)}>{r.tps.length ? fmtUsd(r.tpPnl, { sign: true }) : '–'}</span>}
                  sub={r.blendedR !== null ? `R:R ${r.blendedR.toFixed(2)} · ${fmtPct(r.tpPnlPctAccount, { sign: true })} ${tr('modal', 'of account')}` : tr('isi take-profit', 'add take-profits')}
                />
              </div>
              <dl className="kv calc-kv">
                <dt>Margin</dt>
                <dd>
                  {fmtUsd(r.margin)} <span className="dim">({fmtPct(r.marginPctAccount, { decimals: 1 })} {tr('modal', 'of account')} · min {r.minLeverage}×)</span>
                </dd>
                <dt>{tr('Jarak stop', 'Stop distance')}</dt>
                <dd>{fmtPct(r.stopPct)}</dd>
                <dt>{tr('Harga likuidasi', 'Liquidation price')}</dt>
                <dd className={r.stopBeyondLiq ? 'danger' : ''}>
                  {r.liq ? fmtPx(r.liq) : tr('tidak ada', 'none')}
                  {r.liqDistance !== null && <span className="dim"> ({fmtPct(r.liqDistance)} {tr('dari entry', 'from entry')})</span>}
                </dd>
                <dt>{tr('Likuidasi isolated / cross', 'Liq. isolated / cross')}</dt>
                <dd className="dim">
                  {r.liqIsolated ? fmtPx(r.liqIsolated) : '–'} / {r.liqCross ? fmtPx(r.liqCross) : '–'}
                </dd>
                <dt>Break-even</dt>
                <dd>{fmtPx(r.breakEven)}</dd>
                <dt>{tr('Funding selama pegang', 'Funding while held')}</dt>
                <dd className={r.fundingCost > 0 ? 'neg' : r.fundingCost < 0 ? 'pos' : ''}>
                  {r.fundingCost > 0 ? tr('bayar', 'pay') : r.fundingCost < 0 ? tr('terima', 'receive') : ''} {fmtUsd(Math.abs(r.fundingCost))}{' '}
                  <span className="dim">({fmtPct(Math.abs(r.fundingPctAccount), { decimals: 3 })})</span>
                </dd>
                <dt>Fee</dt>
                <dd className="dim">
                  entry {fmtPct(r.entryFee, { decimals: 3 })} · exit {fmtPct(r.exitFee, { decimals: 3 })} · stop {fmtPct(r.stopFee, { decimals: 3 })}
                </dd>
              </dl>
              {r.tps.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>TP</th>
                        <th className="num">{tr('Harga', 'Price')}</th>
                        <th className="num">Size</th>
                        <th className="num">R</th>
                        <th className="num">PnL</th>
                        <th className="num">% {tr('modal', 'acct')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.tps.map((t) => (
                        <tr key={t.n}>
                          <td>
                            TP{t.n} <span className="dim small">{fmtPct(t.share, { decimals: 0 })}</span>
                          </td>
                          <td className="num">{fmtPx(t.price)}</td>
                          <td className="num">{fmtSize(t.size)}</td>
                          <td className="num">{t.r.toFixed(2)}</td>
                          <td className="num pos">{fmtUsd(t.pnl, { sign: true })}</td>
                          <td className="num">{fmtPct(t.pnlPctAccount, { sign: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {r.warnings.length > 0 && (
                <ul className="calc-msgs warn">
                  {r.warnings.map((w) => (
                    <li key={w}>{warningText(w)}</li>
                  ))}
                </ul>
              )}
              <p className="dim small">
                {tr(
                  'Harga likuidasi adalah perkiraan dari rumus Hyperliquid (maintenance margin = 1 ÷ (2 × leverage maksimal)); belum termasuk fee, funding berjalan, dan posisi cross lain. Ukuran dibulatkan ke bawah sesuai desimal coin, jadi rugi di stop tidak melebihi risiko.',
                  'The liquidation price is an estimate from Hyperliquid’s formula (maintenance margin = 1 ÷ (2 × max leverage)); it ignores fees, accrued funding and other cross positions. Size is rounded down to the coin’s decimals, so the loss at the stop never exceeds the risk.',
                )}
              </p>
            </>
          )}
        </section>
      </div>

      <PriceAlertPanel />
    </div>
  );
}
