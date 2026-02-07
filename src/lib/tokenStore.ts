import { writable } from 'svelte/store'
import type { Token, TokensResponse, UserTokenBalance, UserTokensResponse } from './types'
import { PRICES_API, fetchUserBalances, getTokenIcon } from './utils'

interface TokenWithBalance extends Token {
  userBalance?: string
  userBalanceUsd?: number
  preloadedIcon?: string | null
}

// Hardcoded NEAR token (will be updated from wrap.near)
export const NEAR_TOKEN: Token = {
  account_id: 'near',
  price_usd: '0',
  price_usd_raw: '0',
  price_usd_hardcoded: '0',
  metadata: {
    name: 'NEAR',
    symbol: 'NEAR',
    decimals: 24,
    reference: null,
    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTA4MCIgaGVpZ2h0PSIxMDgwIiB2aWV3Qm94PSIwIDAgMTA4MCAxMDgwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTA4MCIgaGVpZ2h0PSIxMDgwIiBmaWxsPSIjMDBFQzk3Ii8+CjxwYXRoIGQ9Ik03NzMuNDI1IDI0My4zOEM3NTEuNDUzIDI0My4zOCA3MzEuMDU0IDI1NC43NzIgNzE5LjU0NCAyNzMuNDk5TDU5NS41MzggNDU3LjYwNkM1OTEuNDk5IDQ2My42NzMgNTkzLjEzOCA0NzEuODU0IDU5OS4yMDYgNDc1Ljg5M0M2MDQuMTI0IDQ3OS4xNzIgNjEwLjYzMSA0NzguNzY2IDYxNS4xMSA0NzQuOTEzTDczNy4xNzIgMzY5LjA0MkM3MzkuMiAzNjcuMjE3IDc0Mi4zMjcgMzY3LjQwMyA3NDQuMTUyIDM2OS40MzFDNzQ0Ljk4IDM3MC4zNjEgNzQ1LjQyIDM3MS41NjEgNzQ1LjQyIDM3Mi43OTRWNzA0LjI2NUM3NDUuNDIgNzA3LjAwMyA3NDMuMjA2IDcwOS4yIDc0MC40NjggNzA5LjJDNzM4Ljk5NyA3MDkuMiA3MzcuNjExIDcwOC41NTggNzM2LjY4MiA3MDcuNDI1TDM2Ny43MDcgMjY1Ljc1OEMzNTUuNjkgMjUxLjU3NyAzMzguMDQ1IDI0My4zOTcgMzE5LjQ3IDI0My4zOEgzMDYuNTc1QzI3MS42NzMgMjQzLjM4IDI0My4zOCAyNzEuNjczIDI0My4zOCAzMDYuNTc1Vjc3My40MjVDMjQzLjM4IDgwOC4zMjcgMjcxLjY3MyA4MzYuNjIgMzA2LjU3NSA4MzYuNjJDMzI4LjU0NiA4MzYuNjIgMzQ4Ljk0NiA4MjUuMjI4IDM2MC40NTYgODA2LjUwMUw0ODQuNDYyIDYyMi4zOTRDNDg4LjUwMSA2MTYuMzI3IDQ4Ni44NjIgNjA4LjE0NiA0ODAuNzk0IDYwNC4xMDdDNDc1Ljg3NiA2MDAuODI4IDQ2OS4zNjkgNjAxLjIzNCA0NjQuODkgNjA1LjA4N0wzNDIuODI4IDcxMC45NThDMzQwLjggNzEyLjc4MyAzMzcuNjczIDcxMi41OTcgMzM1Ljg0OCA3MTAuNTY5QzMzNS4wMiA3MDkuNjM5IDMzNC41OCA3MDguNDM5IDMzNC41OTcgNzA3LjIwNlYzNzUuNjUxQzMzNC41OTcgMzcyLjkxMyAzMzYuODExIDM3MC43MTUgMzM5LjU0OSAzNzAuNzE1QzM0MS4wMDMgMzcwLjcxNSAzNDIuNDA2IDM3MS4zNTggMzQzLjMzNSAzNzIuNDlMNzEyLjI1OSA4MTQuMjQyQzcyNC4yNzYgODI4LjQyMyA3NDEuOTIxIDgzNi42MDMgNzYwLjQ5NiA4MzYuNjJINzczLjM5MkM4MDguMjkzIDgzNi42MzcgODM2LjYwMyA4MDguMzYxIDgzNi42MzcgNzczLjQ1OVYzMDYuNTc1QzgzNi42MzcgMjcxLjY3MyA4MDguMzQ0IDI0My4zOCA3NzMuNDQyIDI0My4zOEg3NzMuNDI1WiIgZmlsbD0iYmxhY2siLz4KPC9zdmc+'
  },
  total_supply: '0',
  circulating_supply: '0',
  liquidity_usd: 0,
  volume_usd_24h: 0,
  reputation: 'Reputable',
  created_at: 0
}

interface TokenState {
  tokens: TokenWithBalance[]
  isLoading: boolean
  error: string | null
}

function createTokenStore() {
  const { subscribe, update } = writable<TokenState>({
    tokens: [],
    isLoading: false,
    error: null,
  })

  async function fetchTokens(accountId?: string) {
    update(state => ({ ...state, isLoading: true, error: null }))

    try {
      const tokensPromise = fetch(`${PRICES_API}/tokens`)
      const userBalancesPromise = accountId
        ? fetchUserBalances(accountId)
        : Promise.resolve(null)

      const [tokensResponse, userBalancesResponse] = await Promise.all([
        tokensPromise,
        userBalancesPromise
      ])

      if (!tokensResponse.ok) {
        throw new Error('Failed to fetch tokens')
      }

      const tokensData: TokensResponse = await tokensResponse.json()
      let userBalancesData: UserTokensResponse = []

      if (userBalancesResponse) {
        userBalancesData = Object.values(userBalancesResponse)
      }

      const wrapNear = tokensData['wrap.near']
      if (wrapNear) {
        NEAR_TOKEN.price_usd = wrapNear.price_usd
        NEAR_TOKEN.price_usd_raw = wrapNear.price_usd_raw
        NEAR_TOKEN.price_usd_hardcoded = wrapNear.price_usd_hardcoded
        NEAR_TOKEN.liquidity_usd = wrapNear.liquidity_usd
        NEAR_TOKEN.volume_usd_24h = wrapNear.volume_usd_24h
        NEAR_TOKEN.total_supply = wrapNear.total_supply
        NEAR_TOKEN.circulating_supply = wrapNear.circulating_supply
        NEAR_TOKEN.price_usd_raw = wrapNear.price_usd_raw
        NEAR_TOKEN.price_usd_raw_24h_ago = wrapNear.price_usd_raw_24h_ago
      }

      const balanceMap = new Map<string, { balance: string, balanceUsd: number, icon: string | null }>()
      for (const userToken of userBalancesData) {
        const balance = userToken.balance
        const decimals = userToken.token.metadata.decimals
        const priceUsd = parseFloat(userToken.token.price_usd)
        const balanceNumber = parseFloat(balance) / Math.pow(10, decimals)
        const balanceUsd = balanceNumber * priceUsd

        const icon = getTokenIcon(userToken.token)

        balanceMap.set(userToken.token.account_id, {
          balance,
          balanceUsd,
          icon
        })
      }

      let tokensArray: TokenWithBalance[] = Object.values(tokensData)
        .filter(token => token.liquidity_usd > 0)
        .map(token => {
          const userBalance = balanceMap.get(token.account_id)
          return {
            ...token,
            userBalance: userBalance?.balance,
            userBalanceUsd: userBalance?.balanceUsd,
            preloadedIcon: userBalance?.icon
          }
        })

      // Add NEAR token at the beginning if not already present
      const hasNear = tokensArray.some(token => token.account_id === 'near')
      if (!hasNear) {
        const nearBalance = balanceMap.get('near')
        tokensArray.unshift({
          ...NEAR_TOKEN,
          userBalance: nearBalance?.balance,
          userBalanceUsd: nearBalance?.balanceUsd,
          preloadedIcon: NEAR_TOKEN.metadata.icon
        })
      }

      tokensArray = tokensArray.sort((a, b) => {
        // First, sort by user balance USD
        const aHasBalance = (a.userBalanceUsd ?? 0) > 0
        const bHasBalance = (b.userBalanceUsd ?? 0) > 0

        if (aHasBalance && !bHasBalance) return -1
        if (!aHasBalance && bHasBalance) return 1
        if (aHasBalance && bHasBalance) {
          return (b.userBalanceUsd ?? 0) - (a.userBalanceUsd ?? 0)
        }

        // Then by liquidity * log2(volume)
        const aVolumeScore = a.volume_usd_24h > 10 ? Math.log2(a.volume_usd_24h) : 0.1
        const bVolumeScore = b.volume_usd_24h > 10 ? Math.log2(b.volume_usd_24h) : 0.1
        const aScore = a.liquidity_usd * aVolumeScore
        const bScore = b.liquidity_usd * bVolumeScore

        if (Math.abs(aScore - bScore) > 0.001) {
          return bScore - aScore
        }

        // Finally by created_at (newest first)
        return b.created_at - a.created_at
      })

      update(state => ({
        ...state,
        tokens: tokensArray,
        isLoading: false,
      }))
    } catch (error) {
      console.error('Error fetching tokens:', error)
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      }))
    }
  }

  /**
   * Update balances on existing tokens in-place (called by balanceStore on WS events).
   */
  function updateBalances(balances: Record<string, UserTokenBalance>) {
    update(state => {
      const balanceMap = new Map<string, { balance: string, balanceUsd: number }>()
      for (const [tokenId, userToken] of Object.entries(balances)) {
        const balance = userToken.balance
        const decimals = userToken.token.metadata.decimals
        const priceUsd = parseFloat(userToken.token.price_usd)
        const balanceNumber = parseFloat(balance) / Math.pow(10, decimals)
        const balanceUsd = balanceNumber * priceUsd
        balanceMap.set(tokenId, { balance, balanceUsd })
      }

      const tokens = state.tokens.map(token => {
        const updated = balanceMap.get(token.account_id)
        if (updated) {
          return { ...token, userBalance: updated.balance, userBalanceUsd: updated.balanceUsd }
        }
        return token
      })

      return { ...state, tokens }
    })
  }

  return {
    subscribe,
    fetchTokens,
    updateBalances,
  }
}

export const tokenStore = createTokenStore()
