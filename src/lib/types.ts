export interface TokenMetadata {
  name: string
  symbol: string
  decimals: number
  reference: string | null
  icon?: string
}

export interface Token {
  account_id: string
  price_usd: string
  price_usd_raw: string
  price_usd_raw_24h_ago?: string
  metadata: TokenMetadata
  total_supply: string
  circulating_supply: string
  liquidity_usd: number
  volume_usd_24h: number
  reputation: string
  created_at: number
}

export interface TokensResponse {
  [key: string]: Token
}

export interface UserTokenBalance {
  balance: string
  source: string
  token: Token
}

export type UserTokensResponse = UserTokenBalance[]
