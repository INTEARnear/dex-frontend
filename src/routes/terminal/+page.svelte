<script lang="ts">
  import { goto } from "$app/navigation";
  import { onDestroy, onMount } from "svelte";
  import { ChevronLeft } from "lucide-svelte";
  import RecentTradesGrid from "$lib/RecentTradesGrid.svelte";
  import SwapForm from "$lib/SwapForm.svelte";
  import { tokenHubStore } from "$lib/tokenHubStore";

  const STABLECOIN_SYMBOLS = new Set(["USDC", "USDt"]);
  const NEAR_SYMBOLS = new Set(["NEAR", "wNEAR"]);

  let inputTokenId = $state<string | null>(null);
  let outputTokenId = $state<string | null>(null);
  let chartTheme = $state<"light" | "dark">("dark");

  function tokenHasSymbol(
    tokenId: string | null,
    symbols: ReadonlySet<string>,
  ): boolean {
    if (!tokenId) return false;
    return symbols.has(
      $tokenHubStore.tokensById[tokenId]?.metadata.symbol ?? "",
    );
  }

  const chartTokenId = $derived.by(() => {
    if (tokenHasSymbol(inputTokenId, STABLECOIN_SYMBOLS)) return outputTokenId;
    if (tokenHasSymbol(outputTokenId, STABLECOIN_SYMBOLS)) return inputTokenId;
    if (tokenHasSymbol(inputTokenId, NEAR_SYMBOLS)) return outputTokenId;
    if (tokenHasSymbol(outputTokenId, NEAR_SYMBOLS)) return inputTokenId;
    return outputTokenId;
  });
  const chartToken = $derived(
    chartTokenId ? ($tokenHubStore.tokensById[chartTokenId] ?? null) : null,
  );
  const chartSrc = $derived(
    chartTokenId
      ? `https://chart.intear.tech/?token=${encodeURIComponent(chartTokenId)}&search=false&theme=${chartTheme}`
      : null,
  );

  function resolveTheme(): "light" | "dark" {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  onMount(() => {
    if (!window.matchMedia("(min-width: 1180px)").matches) {
      void goto("/", { replaceState: true });
      return;
    }

    tokenHubStore.updatePricesEvery(10_000);
    tokenHubStore.updateBalancesEvery(1_000);

    chartTheme = resolveTheme();
    const themeObserver = new MutationObserver(() => {
      chartTheme = resolveTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => themeObserver.disconnect();
  });

  onDestroy(() => {
    tokenHubStore.updateBalancesEvery(null);
  });
</script>

<div class="terminal-layout">
  <section class="chart-panel" aria-label="Token chart">
    {#if chartSrc}
      <iframe
        src={chartSrc}
        title={`${chartToken?.metadata.symbol ?? "Selected token"} chart`}
        class="chart-frame"
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    {:else}
      <div class="panel-placeholder">Select a token to view its chart.</div>
    {/if}
  </section>

  <div class="right-column">
    <SwapForm
      bind:inputTokenId
      bind:outputTokenId
      hideSubtitle
      reserveRouteInfoSpace
    >
      {#snippet sideControl()}
        <button
          type="button"
          class="terminal-toggle"
          onclick={() => goto("/")}
          aria-label="Return to simple swap view"
          title="Return to simple view"
        >
          <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
        </button>
      {/snippet}
    </SwapForm>

    <section class="trades-panel" aria-label="Recent trades">
      {#if chartTokenId}
        <RecentTradesGrid tokenAccountId={chartTokenId} />
      {:else}
        <div class="panel-placeholder">Select a token to view recent trades.</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .terminal-layout {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(524px, 584px);
    gap: 1rem;
    align-items: stretch;
  }

  .right-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .terminal-toggle {
    width: 2.75rem;
    flex: 0 0 2.75rem;
    margin-left: -1px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border-color);
    border-left: 0;
    border-radius: 0 1.25rem 1.25rem 0;
    background: var(--bg-card);
    color: var(--accent-primary);
    cursor: pointer;
    transition:
      color 0.2s ease,
      border-color 0.2s ease;
  }

  .terminal-toggle:hover {
    border-color: var(--accent-primary);
  }

  .terminal-toggle:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  .chart-panel {
    min-width: 0;
    min-height: 720px;
    overflow: hidden;
  }

  .chart-frame {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 720px;
    border: 1.2px solid var(--border-color);
    border-radius: 0.375rem 1rem 1rem 1rem;
  }

  .trades-panel {
    min-width: 0;
    max-height: 520px;
    overflow: auto;
    border-radius: 1rem;
    scrollbar-gutter: stable;
  }

  .panel-placeholder {
    width: 100%;
    min-height: 16rem;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    text-align: center;
  }

  @media (max-width: 1179px) {
    .terminal-layout {
      display: none;
    }
  }
</style>
