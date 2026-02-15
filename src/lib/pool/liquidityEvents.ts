import { parseNep297FromLog } from "../nep297";

export interface LiquidityAddedEventData {
  pool_id: number;
  asset_0: string;
  asset_1: string;
  added_amount_0: string;
  added_amount_1: string;
  minted_shares: string;
  new_owned_asset_0: string;
  new_owned_asset_1: string;
  new_owned_shares: string;
  new_total_asset_0: string;
  new_total_asset_1: string;
  new_total_shares: string;
}

export interface LiquidityRemovedEventData {
  pool_id: number;
  asset_0: string;
  asset_1: string;
  removed_amount_0: string;
  removed_amount_1: string;
  burned_shares: string;
  new_owned_asset_0: string;
  new_owned_asset_1: string;
  new_owned_shares: string;
  new_total_asset_0: string;
  new_total_asset_1: string;
  new_total_shares: string;
}

type DexEventData = {
  standard?: string;
  version?: string;
  event?: string;
  data?: {
    dex_id?: string;
    event?: {
      standard?: string;
      version?: string;
      event?: string;
      data?: LiquidityAddedEventData | LiquidityRemovedEventData;
    };
    referrer?: unknown;
    user?: string;
  };
};

export function parseLiquidityAddedFromOutcomes(
  outcomes: unknown,
): LiquidityAddedEventData | null {
  if (!outcomes || !Array.isArray(outcomes)) return null;

  for (const outcome of outcomes) {
    if (!outcome?.receipts_outcome) continue;

    for (const receiptOutcome of outcome.receipts_outcome) {
      const logs = receiptOutcome.outcome?.logs;
      if (!logs || !Array.isArray(logs)) continue;

      for (const log of logs) {
        const eventData = parseNep297FromLog<DexEventData>(log);
        if (!eventData) continue;

        if (
          eventData.standard === "inteardex" &&
          eventData.event === "dex_event" &&
          eventData.data?.event?.event === "liquidity_added"
        ) {
          const data = eventData.data.event.data;
          if (data && typeof data === "object") {
            return data as LiquidityAddedEventData;
          }
        }
      }
    }
  }

  return null;
}

export function parseLiquidityRemovedFromOutcomes(
  outcomes: unknown,
): LiquidityRemovedEventData | null {
  if (!outcomes || !Array.isArray(outcomes)) return null;

  for (const outcome of outcomes) {
    if (!outcome?.receipts_outcome) continue;

    for (const receiptOutcome of outcome.receipts_outcome) {
      const logs = receiptOutcome.outcome?.logs;
      if (!logs || !Array.isArray(logs)) continue;

      for (const log of logs) {
        const eventData = parseNep297FromLog<DexEventData>(log);
        if (!eventData) continue;

        if (
          eventData.standard === "inteardex" &&
          eventData.event === "dex_event" &&
          eventData.data?.event?.event === "liquidity_removed"
        ) {
          const data = eventData.data.event.data;
          if (data && typeof data === "object") {
            return data as LiquidityRemovedEventData;
          }
        }
      }
    }
  }

  return null;
}
