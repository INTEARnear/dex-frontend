import { writable } from 'svelte/store'
import { NearConnector } from '@hot-labs/near-connect'
import type { NearWalletBase } from '@hot-labs/near-connect'

interface WalletState {
  isConnected: boolean
  accountId: string | null
  wallet: NearWalletBase | null
}

function createWalletStore() {
  const { subscribe, set, update } = writable<WalletState>({
    isConnected: false,
    accountId: null,
    wallet: null,
  })

  const connector = new NearConnector()

  connector.on('wallet:signIn', async (event) => {
    const wallet = await connector.wallet()
    update(() => ({
      isConnected: true,
      accountId: event.accounts[0].accountId,
      wallet,
    }))
  })

  connector.on('wallet:signOut', async () => {
    set({
      isConnected: false,
      accountId: null,
      wallet: null,
    })
  })

  // Check if already connected on init
  async function checkConnection() {
    try {
      const wallet = await connector.wallet()
      const accounts = await wallet.getAccounts()
      if (accounts.length > 0) {
        update(() => ({
          isConnected: true,
          accountId: accounts[0].accountId,
          wallet,
        }))
      }
    } catch (error) {
      // Not connected
      console.log('No wallet connected')
    }
  }

  checkConnection()

  return {
    subscribe,
    connect: async () => {
      try {
        await connector.connect()
      } catch (error) {
        console.error('Failed to connect wallet:', error)
        throw error
      }
    },
    disconnect: async () => {
      try {
        await connector.disconnect()
      } catch (error) {
        console.error('Failed to disconnect wallet:', error)
        throw error
      }
    },
    getConnector: () => connector,
  }
}

export const walletStore = createWalletStore()
