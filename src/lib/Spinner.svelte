<script lang="ts">
  interface Props {
    size?: number;
    borderWidth?: number;
    tone?: "accent" | "light";
    className?: string;
  }

  let {
    size = 16,
    borderWidth = 2,
    tone = "accent",
    className = "",
  }: Props = $props();
</script>

<span
  aria-hidden="true"
  class={`spinner ${tone} ${className}`.trim()}
  style={`--spinner-size: ${size}px; --spinner-border-width: ${borderWidth}px;`}
></span>

<style>
  .spinner {
    display: inline-block;
    width: var(--spinner-size);
    height: var(--spinner-size);
    border-radius: 50%;
    border: var(--spinner-border-width) solid var(--spinner-track-color);
    border-top-color: var(--spinner-head-color);
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .spinner.accent {
    --spinner-track-color: var(--border-color);
    --spinner-head-color: var(--accent-primary);
  }

  .spinner.light {
    --spinner-track-color: color-mix(
      in oklab,
      var(--text-on-accent),
      transparent 70%
    );
    --spinner-head-color: var(--text-on-accent);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
