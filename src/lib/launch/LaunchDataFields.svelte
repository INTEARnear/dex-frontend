<script lang="ts">
  interface Props {
    description: string;
    telegram: string;
    x: string;
    twitch: string;
    website: string;
  }

  let {
    description = $bindable(""),
    telegram = $bindable(""),
    x = $bindable(""),
    twitch = $bindable(""),
    website = $bindable(""),
  }: Props = $props();
</script>

<div class="section">
  <label class="field">
    <span class="field-label">Description (optional)</span>
    <textarea
      placeholder="Describe your token. Lore, source of the meme, etc."
      bind:value={description}
      maxlength={200}
      rows={3}
    ></textarea>
    <span class="field-counter">{description.length}/200</span>
  </label>
</div>

<div class="section">
  <div class="links-grid">
    <label class="field">
      <span class="field-label">Telegram</span>
      <input
        type="url"
        placeholder="https://t.me/tokenchat"
        bind:value={telegram}
        maxlength={50}
        spellcheck="false"
      />
    </label>
    <label class="field">
      <span class="field-label">X</span>
      <input
        type="url"
        placeholder="https://x.com/yourtoken"
        bind:value={x}
        maxlength={50}
        spellcheck="false"
      />
    </label>
    <label class="field">
      <span class="field-label">Twitch</span>
      <input
        type="url"
        placeholder="https://twitch.tv/yourchannel"
        bind:value={twitch}
        maxlength={50}
        spellcheck="false"
      />
    </label>
    <label class="field full-width">
      <span class="field-label">Website</span>
      <input
        type="url"
        placeholder="https://example.com"
        bind:value={website}
        maxlength={50}
        spellcheck="false"
      />
    </label>
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .links-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .full-width {
    grid-column: 1 / -1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .field-counter {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.72rem;
    font-family: "JetBrains Mono", monospace;
  }

  .field input,
  .field textarea {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    color: var(--text-primary);
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
  }

  .field textarea {
    resize: vertical;
    min-height: 5rem;
  }

  .field input:focus-visible,
  .field textarea:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
  }
</style>
