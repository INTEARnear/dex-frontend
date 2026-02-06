import { readable } from 'svelte/store'
import { fetchPrices } from './utils'

/**
 * Shared price store that polls the prices API every 10 seconds.
 */
export const priceStore = readable<Record<string, string>>({}, (set) => {
  let stopped = false

  async function refresh() {
    try {
      const prices = await fetchPrices()
      if (!stopped) set(prices)
    } catch {
      // Silently ignore price refresh errors
    }
  }

  refresh()
  const interval = setInterval(refresh, 10000)

  return () => {
    stopped = true
    clearInterval(interval)
  }
})
