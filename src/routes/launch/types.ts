import type { TokenInfo } from "../../lib/types";

export type LaunchSortBy = "newest" | "marketCap" | "volume";

export interface LaunchApiTokenData {
  x: string | null;
  telegram: string | null;
  website: string | null;
  description: string | null;
  launched_by: string;
  launched_at_ns: number;
}

export type LaunchApiResponse = Record<string, LaunchApiTokenData>;

export interface LaunchToken {
  token: TokenInfo;
  launchData: LaunchApiTokenData;
}
