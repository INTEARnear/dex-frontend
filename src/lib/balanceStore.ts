import { writable } from 'svelte/store'
import { walletStore } from './walletStore'
import { fetchUserBalances } from './utils'
import { tokenStore } from './tokenStore'

const WS_EVENTS_BASE = 'wss://ws-events-v3.intear.tech/events'

/**
 * Shared store for user token balances (token account_id -> raw balance string).
 * All components should use this as the single source of truth for balances.
 */
export const userBalances = writable<Record<string, string>>({})

let activeSockets: WebSocket[] = []
let currentAccountId: string | null = null

/**
 * Fetch fresh balances from the API and update all stores.
 */
export async function refreshBalances(accountId?: string): Promise<void> {
  const account = accountId ?? currentAccountId
  if (!account) return

  try {
    const balances = await fetchUserBalances(account)
    const rawBalances = Object.fromEntries(
      Object.entries(balances).map(([key, value]) => [key, value.balance])
    )
    userBalances.set(rawBalances)
    tokenStore.updateBalances(balances)
  } catch (error) {
    console.error('Failed to refresh balances:', error)
  }
}

function closeAllSockets() {
  for (const ws of activeSockets) {
    ws.close()
  }
  activeSockets = []
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

function createEventSocket(eventName: string, filter: object, accountId: string): WebSocket {
  let reconnectDelay = RECONNECT_BASE_MS

  function connect(): WebSocket {
    const ws = new WebSocket(`${WS_EVENTS_BASE}/${eventName}`)

    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS
      ws.send(JSON.stringify(filter))
    }

    ws.onmessage = () => {
      setTimeout(() => {
        refreshBalances()
      }, 500)
    }

    ws.onerror = (error) => {
      console.error(`WebSocket error for ${eventName}:`, error)
    }

    ws.onclose = () => {
      // Only reconnect if this account is still active
      if (currentAccountId !== accountId) return

      const idx = activeSockets.indexOf(ws)
      if (idx !== -1) activeSockets.splice(idx, 1)

      setTimeout(() => {
        if (currentAccountId !== accountId) return
        const newWs = connect()
        activeSockets.push(newWs)
      }, reconnectDelay)

      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    }

    return ws
  }

  return connect()
}

function setupWebSockets(accountId: string) {
  closeAllSockets()
  currentAccountId = accountId

  // ft_transfer: match when account is sender or receiver
  const transferFilter = {
    And: [{
      path: ".",
      operator: {
        Or: [
          { path: "old_owner_id", operator: { Equals: accountId } },
          { path: "new_owner_id", operator: { Equals: accountId } }
        ]
      }
    }]
  }

  // ft_mint: match when account is the recipient
  const mintFilter = {
    And: [{
      path: "owner_id",
      operator: { Equals: accountId }
    }]
  }

  // ft_burn: match when account is the owner
  const burnFilter = {
    And: [{
      path: "owner_id",
      operator: { Equals: accountId }
    }]
  }

  activeSockets.push(createEventSocket('ft_transfer', transferFilter, accountId))
  activeSockets.push(createEventSocket('ft_mint', mintFilter, accountId))
  activeSockets.push(createEventSocket('ft_burn', burnFilter, accountId))
}

function teardown() {
  closeAllSockets()
  currentAccountId = null
  userBalances.set({})
}

// React to wallet connection changes
walletStore.subscribe(state => {
  if (state.accountId) {
    setupWebSockets(state.accountId)
    refreshBalances(state.accountId)
  } else {
    teardown()
  }
})
