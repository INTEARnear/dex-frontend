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
  fees: {
    receivers: Array<[XykFeeReceiver, number]>;
  };
  owner_id: string;
}

export interface XykPublicPoolData {
  assets: [AssetWithBalance, AssetWithBalance];
  fees: {
    receivers: Array<[XykFeeReceiver, number]>;
  };
  total_shares: string;
}

export interface XykPool {
  id: number;
  pool: {
    Private?: XykPrivatePoolData;
    Public?: XykPublicPoolData;
  };
  volume_24h_usd: number;
  volume_7d_usd: number;
}
