<script lang="ts">
  import { goto } from "$app/navigation";
  import { onDestroy, onMount } from "svelte";
  import { ChevronRight } from "lucide-svelte";
  import SwapForm from "$lib/SwapForm.svelte";
  import { tokenHubStore } from "$lib/tokenHubStore";

  onMount(() => {
    tokenHubStore.updatePricesEvery(10_000);
    tokenHubStore.updateBalancesEvery(1_000);
  });

  onDestroy(() => {
    tokenHubStore.updateBalancesEvery(null);
  });
</script>

<SwapForm>
  {#snippet sideControl()}
    <button
      type="button"
      class="terminal-toggle"
      onclick={() => goto("/terminal")}
      aria-label="Open advanced trading terminal"
      title="Open terminal"
    >
      <ChevronRight size={22} strokeWidth={2.25} aria-hidden="true" />
    </button>
  {/snippet}
</SwapForm>

<style>
  .terminal-toggle {
    display: none;
  }

  @media (min-width: 1180px) {
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
  }
</style>
