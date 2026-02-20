<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import SwapForm from "../lib/SwapForm.svelte";
  import { tokenHubStore } from "../lib/tokenHubStore";

  onMount(() => {
    tokenHubStore.updatePricesEvery(10_000);
    tokenHubStore.updateBalancesEvery(1_000);
  });

  onDestroy(() => {
    tokenHubStore.updateBalancesEvery(null);
  });
</script>

<SwapForm />
