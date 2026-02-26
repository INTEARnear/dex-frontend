<script lang="ts">
  import { page } from "$app/state";

  const isNotFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{isNotFound ? "404 - Page Not Found" : "Error"} | Intear DEX</title>
</svelte:head>

<section class="error-card">
  <h2>{isNotFound ? "Page not found" : "Something went wrong"}</h2>
  <p class="description">
    {#if isNotFound}
      The page you requested does not exist.
    {:else}
      An unexpected error occurred while loading this page.
    {/if}
  </p>
  <a href="/" class="home-link">Go Back</a>
</section>

<style>
  .error-card {
    width: 100%;
    max-width: 540px;
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    background: var(--bg-card);
    padding: 1.5rem;
    text-align: center;
  }

  h2 {
    margin: 0.25rem 0 0;
    font-size: 1.5rem;
    color: var(--text-primary);
  }

  .description {
    margin: 0.75rem 0 0;
    color: var(--text-secondary);
  }

  .home-link {
    margin-top: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem 1rem;
    border-radius: 0.625rem;
    text-decoration: none;
    font-weight: 600;
    color: var(--text-on-accent);
    background: var(--accent-button);
    transition: background 0.2s ease;
  }

  .home-link:hover {
    background: var(--accent-hover);
  }
</style>
