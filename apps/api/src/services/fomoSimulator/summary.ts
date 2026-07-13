/**
 * FOMO Simulator V1 — scorecard.
 *
 * Documented denominators:
 *  - Win rate uses ONLY closed, successfully priced positions (realized P/L
 *    exists). HOLD events are never separate wins. AVOID / NO_TRADE calls and
 *    unpriced BUY calls are never portfolio trades.
 *  - Missing statistics stay null — the frontend shows "—" or "Not enough
 *    data", never a fake 0%.
 *  - Realized and unrealized P/L are kept strictly separate; "net" is their
 *    sum only when at least one component exists.
 *  - Results cover ONLY calls recorded by this feature. This is not a claim
 *    of historical accuracy — backtesting is a later phase.
 */
import type { PrismaClient } from '@prisma/client';
import { D, exact, sum } from '../walletPositions/math.js';
import { FOMO_METHODOLOGY_VERSION } from './mapping.js';

export interface FomoSummary {
  methodologyVersion: string;
  netPlUsd: string | null;
  realizedPlUsd: string | null;
  unrealizedPlUsd: string | null;
  openTradeCount: number;
  closedTradeCount: number;
  /** null until at least one priced paper trade has closed. */
  winRatePct: string | null;
  winningClosedCount: number | null;
  highConvictionPlUsd: string | null;
  highConvictionTradeCount: number;
  calls: {
    total: number;
    buy: number;
    hold: number;
    exit: number;
    avoid: number;
    noTrade: number;
    unpriced: number;
  };
}

export async function buildFomoSummary(prisma: PrismaClient): Promise<FomoSummary> {
  const [positions, calls] = await Promise.all([
    prisma.paperPosition.findMany({ where: { methodologyVersion: FOMO_METHODOLOGY_VERSION } }),
    prisma.paperCall.findMany({
      where: { fomoMethodologyVersion: FOMO_METHODOLOGY_VERSION },
      select: { action: true, priced: true, conviction: true, paperPositionId: true },
    }),
  ]);

  const open = positions.filter((p) => p.status === 'OPEN');
  const closed = positions.filter((p) => p.status === 'CLOSED');
  const closedPriced = closed.filter((p) => p.realizedPlUsd !== null);

  const realized = sum(closedPriced.map((p) => D(p.realizedPlUsd!)));
  const openValued = open.filter((p) => p.unrealizedPlUsd !== null);
  const unrealized = sum(openValued.map((p) => D(p.unrealizedPlUsd!)));
  const net =
    realized === null && unrealized === null ? null : (realized ?? D(0)).plus(unrealized ?? D(0));

  const winners = closedPriced.filter((p) => D(p.realizedPlUsd!).gt(0));
  const winRate =
    closedPriced.length === 0 ? null : D(winners.length).div(closedPriced.length).mul(100);

  // High-conviction trades: positions whose opening BUY call had HIGH conviction.
  const highConvictionPositionIds = new Set(
    calls
      .filter((c) => c.action === 'BUY' && c.conviction === 'HIGH' && c.paperPositionId !== null)
      .map((c) => c.paperPositionId!),
  );
  const highConvictionPls = positions
    .filter((p) => highConvictionPositionIds.has(p.id))
    .map((p) => (p.status === 'CLOSED' ? p.realizedPlUsd : p.unrealizedPlUsd))
    .filter((pl): pl is string => pl !== null)
    .map((pl) => D(pl));
  const highConvictionPl = sum(highConvictionPls);

  const byAction = (action: string) => calls.filter((c) => c.action === action).length;

  return {
    methodologyVersion: FOMO_METHODOLOGY_VERSION,
    netPlUsd: net === null ? null : exact(net),
    realizedPlUsd: realized === null ? null : exact(realized),
    unrealizedPlUsd: unrealized === null ? null : exact(unrealized),
    openTradeCount: open.length,
    closedTradeCount: closed.length,
    winRatePct: winRate === null ? null : exact(winRate),
    winningClosedCount: closedPriced.length === 0 ? null : winners.length,
    highConvictionPlUsd: highConvictionPl === null ? null : exact(highConvictionPl),
    highConvictionTradeCount: highConvictionPositionIds.size,
    calls: {
      total: calls.length,
      buy: byAction('BUY'),
      hold: byAction('HOLD'),
      exit: byAction('EXIT'),
      avoid: byAction('AVOID'),
      noTrade: byAction('NO_TRADE'),
      unpriced: calls.filter((c) => !c.priced).length,
    },
  };
}
