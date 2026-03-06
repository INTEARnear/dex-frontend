import type { TokenInfo } from "../types";

export type LaunchSortBy = "newest" | "marketCap" | "volume";

export interface LaunchDataArgs {
  telegram: string | null;
  x: string | null;
  website: string | null;
  description: string | null;
}

export interface LaunchApiTokenData extends LaunchDataArgs {
  launched_by: string;
  launched_at_ns: number;
}

export type LaunchApiResponse = Record<string, LaunchApiTokenData>;

export interface LaunchToken {
  token: TokenInfo;
  launchData: LaunchApiTokenData;
}

export interface LaunchTradeSwapEvent {
  balance_changes: Record<string, string>;
  block_height: number;
  block_timestamp_nanosec: string;
  receipt_id: string;
  referrer?: string;
  trader: string;
  transaction_id: string;
}

export type LaunchTradeType = "BUY" | "SELL";
export type LaunchTradesTimeMode = "relative" | "absolute";
export type LaunchTradesExplorer = "nearblocks" | "pikespeak";
export type LaunchTradesColumnKey =
  | "time"
  | "type"
  | "amount"
  | "trader"
  | "txn";

export interface LaunchTradesColumnWidths {
  time: number;
  type: number;
  amount: number;
  trader: number;
  txn: number;
}

export interface LaunchTradesViewerConfig {
  timeMode: LaunchTradesTimeMode;
  traderExplorer: LaunchTradesExplorer;
  txnExplorer: LaunchTradesExplorer;
  columnWidths: LaunchTradesColumnWidths;
}
