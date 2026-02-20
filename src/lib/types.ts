export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  reference: string | null;
  icon?: string;
}

export interface Token {
  account_id: string;
  price_usd: string;
  price_usd_hardcoded: string;
  price_usd_raw: string;
  price_usd_raw_24h_ago?: string;
  metadata: TokenMetadata;
  total_supply: string;
  circulating_supply: string;
  liquidity_usd: number;
  volume_usd_24h: number;
  reputation: string;
  created_at: number;
}

export interface TokensResponse {
  [key: string]: TokenResponseWithIcon;
}

export type TokenResponse = Omit<Token, "metadata"> & {
  metadata: Omit<TokenMetadata, "icon">;
};

export type TokenResponseWithIcon = Token;

export interface UserTokenResponse {
  balance: string;
  source: string;
  token: TokenResponseWithIcon;
}

export interface TokenInfo extends TokenResponseWithIcon {
  balance?: string;
  balanceSource?: string;
  balanceUsd?: number;
}

export interface AssetWithBalance {
  asset_id: string;
  balance: string;
}

export type XykFeeReceiver = { Account: string } | "Pool";

export interface XykPrivatePoolData {
  assets: [AssetWithBalance, AssetWithBalance];
  fees: XykCurrentFees;
  fee_configuration: XykFeeConfiguration;
  owner_id: string;
  locked: boolean;
}

export interface XykPublicPoolData {
  assets: [AssetWithBalance, AssetWithBalance];
  fees: XykCurrentFees;
  fee_configuration: XykFeeConfiguration;
  total_shares: string;
}

export interface XykLaunchPoolData {
  near_amount: string;
  launched_asset: AssetWithBalance;
  fees: XykCurrentFees;
  fee_configuration: XykFeeConfiguration;
  phantom_liquidity_near: string;
}

export type XykPoolData =
  | {
      Private: XykPrivatePoolData;
    }
  | {
      Public: XykPublicPoolData;
    }
  | {
      Launch: XykLaunchPoolData;
    };

export interface XykPool {
  id: number;
  pool: XykPoolData;
  volume_24h_usd: number;
  volume_7d_usd: number;
}

export interface NormalizedPool {
  ownerId: string | null;
  assets: [AssetWithBalance, AssetWithBalance];
  fees: XykCurrentFees;
  fee_configuration: XykFeeConfiguration;
  totalSharesRaw: string | null;
  locked: boolean;
}

export type XykCurrentFees = {
  receivers: [XykFeeReceiver, number][];
};

export type XykFeeConfigurationV2 = {
  receivers: [XykFeeReceiver, XykFeeAmount][];
};

export type XykFeeAmount =
  | { Fixed: number }
  | {
      Scheduled: {
        start: [number, number];
        end: [number, number];
        curve: { Linear: {} };
      };
    }
  | { Dynamic: { min: number; max: number } };

export type XykFeeConfiguration = XykCurrentFees | XykFeeConfigurationV2;

export function normalizePool(pool: XykPoolData): NormalizedPool {
  if ("Private" in pool) {
    return {
      ownerId: pool.Private.owner_id,
      assets: pool.Private.assets,
      fees: pool.Private.fees,
      fee_configuration: pool.Private.fee_configuration,
      totalSharesRaw: null,
      locked: pool.Private.locked,
    };
  }
  if ("Public" in pool) {
    return {
      ownerId: null,
      assets: pool.Public.assets,
      fees: pool.Public.fees,
      fee_configuration: pool.Public.fee_configuration,
      totalSharesRaw: pool.Public.total_shares,
      locked: false,
    };
  }
  if ("Launch" in pool) {
    return {
      ownerId: null,
      assets: [
        { asset_id: "near", balance: pool.Launch.near_amount },
        pool.Launch.launched_asset,
      ],
      fees: pool.Launch.fees,
      fee_configuration: pool.Launch.fee_configuration,
      totalSharesRaw: null,
      locked: true,
    };
  }
  throw new Error("Unsupported pool type");
}
