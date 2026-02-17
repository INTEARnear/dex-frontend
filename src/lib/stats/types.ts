import type { TokenInfo } from "../types";

export const STATS_TABS = ["Volume", "Tvl"] as const;
export type StatsTab = (typeof STATS_TABS)[number];

export const STATS_TIMEFRAMES = ["Day", "Week", "Month"] as const;
export type StatsTimeframe = (typeof STATS_TIMEFRAMES)[number];

export type StatsSelection =
  | { kind: "total" }
  | { kind: "pool"; poolId: number | null }
  | { kind: "asset"; assetId: string | null };

export interface StatsRouteState {
  tab: StatsTab;
  timeframe: StatsTimeframe;
  selection: StatsSelection;
}

export interface ParsedStatsQuery {
  state: StatsRouteState;
  canonicalSearchParams: URLSearchParams;
  isCanonical: boolean;
}

export interface StatsSeriesPoint {
  timestamp: string;
  valueUsd: number;
}

export interface StatsPoolListItem {
  kind: "pool";
  poolId: number;
  valueUsd: number;
  primaryLabel: string;
  secondaryLabel: string;
  tokens: [TokenInfo | null, TokenInfo | null];
}

export interface StatsAssetListItem {
  kind: "asset";
  assetId: string;
  valueUsd: number;
  primaryLabel: string;
  secondaryLabel: string;
  token: TokenInfo | null;
}

export interface StatsTotalReadyData {
  kind: "total";
  series: StatsSeriesPoint[];
}

export interface StatsPoolReadyData {
  kind: "pool";
  items: StatsPoolListItem[];
  selectedPoolId: number | null;
  series: StatsSeriesPoint[];
}

export interface StatsAssetReadyData {
  kind: "asset";
  items: StatsAssetListItem[];
  selectedAssetId: string | null;
  series: StatsSeriesPoint[];
}

export type StatsReadyData =
  | StatsTotalReadyData
  | StatsPoolReadyData
  | StatsAssetReadyData;

export type StatsRuntimeState =
  | { status: "loading"; route: StatsRouteState }
  | { status: "ready"; route: StatsRouteState; data: StatsReadyData }
  | { status: "error"; route: StatsRouteState; message: string };

export interface VolumeSeriesPointResponse {
  timestamp: string;
  volume_usd: number;
}

export interface TvlSeriesPointResponse {
  timestamp: string;
  tvl_usd: number;
}

export interface VolumeTopPoolResponseItem {
  pool_id: number;
  volume_usd: number;
}

export interface VolumeTopAssetResponseItem {
  asset_id: string;
  volume_usd: number;
}
