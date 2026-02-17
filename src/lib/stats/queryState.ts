import type {
  ParsedStatsQuery,
  StatsRouteState,
  StatsTab,
  StatsTimeframe,
} from "./types";

const DEFAULT_TAB: StatsTab = "Volume";
const DEFAULT_TIMEFRAME: StatsTimeframe = "Day";

function parseTab(rawValue: string | null): StatsTab {
  return rawValue === "Volume" || rawValue === "Tvl" ? rawValue : DEFAULT_TAB;
}

function parseTimeframe(rawValue: string | null): StatsTimeframe {
  return rawValue === "Day" || rawValue === "Week" || rawValue === "Month"
    ? rawValue
    : DEFAULT_TIMEFRAME;
}

function parsePoolId(rawValue: string | null): number | null {
  if (!rawValue) return null;
  if (rawValue === "None") return null;
  if (!/^\d+$/.test(rawValue)) return null;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseAssetId(rawValue: string | null): string | null {
  if (!rawValue) return null;
  if (rawValue === "None") return null;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildStatsRouteState(
  searchParams: URLSearchParams,
): StatsRouteState {
  const tab = parseTab(searchParams.get("tab"));
  const timeframe = parseTimeframe(searchParams.get("timeframe"));
  const rawPool = searchParams.get("pool");
  const rawAsset = searchParams.get("asset");
  const hasPoolParam = rawPool !== null;
  const hasAssetParam = rawAsset !== null;
  const poolId = parsePoolId(rawPool);
  const assetId = parseAssetId(rawAsset);

  if (hasPoolParam) {
    return { tab, timeframe, selection: { kind: "pool", poolId } };
  }

  if (hasAssetParam) {
    return { tab, timeframe, selection: { kind: "asset", assetId } };
  }

  return { tab, timeframe, selection: { kind: "total" } };
}

export function buildStatsSearchParams(
  state: StatsRouteState,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", state.tab);
  params.set("timeframe", state.timeframe);

  if (state.selection.kind === "pool") {
    params.set(
      "pool",
      state.selection.poolId === null ? "None" : String(state.selection.poolId),
    );
  } else if (state.selection.kind === "asset") {
    params.set("asset", state.selection.assetId ?? "None");
  }

  return params;
}

export function parseStatsQuery(
  searchParams: URLSearchParams,
): ParsedStatsQuery {
  const state = buildStatsRouteState(searchParams);
  const canonicalSearchParams = buildStatsSearchParams(state);
  const isCanonical =
    canonicalSearchParams.toString() === searchParams.toString();

  return {
    state,
    canonicalSearchParams,
    isCanonical,
  };
}

export function withTab(
  state: StatsRouteState,
  tab: StatsTab,
): StatsRouteState {
  return { ...state, tab };
}

export function withTimeframe(
  state: StatsRouteState,
  timeframe: StatsTimeframe,
): StatsRouteState {
  return { ...state, timeframe };
}

export function withTotalSelection(state: StatsRouteState): StatsRouteState {
  return { ...state, selection: { kind: "total" } };
}

export function withPoolSelection(
  state: StatsRouteState,
  poolId: number | null,
): StatsRouteState {
  return { ...state, selection: { kind: "pool", poolId } };
}

export function withAssetSelection(
  state: StatsRouteState,
  assetId: string | null,
): StatsRouteState {
  return { ...state, selection: { kind: "asset", assetId } };
}
