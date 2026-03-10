<script lang="ts">
  import { onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { CircleAlert, LoaderCircle, Upload, X } from "lucide-svelte";
  import { focusFirstElement, trapFocusKeydown } from "../a11y";
  import { walletStore } from "../walletStore";
  import { tokenHubStore } from "../tokenHubStore";
  import { createChatwootModalVisibilityController } from "../chatwootBubbleVisibility";
  import ErrorModal from "../ErrorModal.svelte";
  import LaunchDataFields from "./LaunchDataFields.svelte";
  import FeeReceiversEditor, {
    type FeeAmountDraft,
    type FeeReceiverDraft,
    type FeeReceiversEditorState,
  } from "../pool/FeeReceiversEditor.svelte";
  import { draftAmountToSchemaXykFeeAmount } from "../pool/feeUtils";
  import { GAS_RESERVE_NEAR, assertOutcomesSucceeded } from "../pool/shared";
  import { humanReadableToRawAmount, rawAmountToHumanReadable } from "../utils";
  import type { LaunchDataArgs } from "./types";
  import type { XykFeeAmount, XykFeeEntry } from "$lib/types";
  import type { FinalExecutionOutcome } from "@hot-labs/near-connect/build/types";

  const LAUNCH_CONTRACT_ID = "launch.intear.near";
  const NEAR_DECIMALS = 24;
  const BYTES_OVERHEAD = 4000;
  const COST_PER_BYTE_YOCTO = 10n ** 19n; // 0.00001 NEAR
  const ONE_NEAR_YOCTO = 10n ** 24n;
  const ICON_SIZE = 128;
  const ICON_QUALITY = 0.3;
  const MIN_TOTAL_SUPPLY = 1_000n;
  const MAX_TOTAL_SUPPLY = 1_000_000_000_000_000_000n;
  const DEFAULT_TOTAL_SUPPLY = "1000000000";

  interface LaunchTokenArgs {
    name: string;
    symbol: string;
    icon: string | null;
    decimals: number;
    total_supply: string;
    short_id: boolean;
    fees: XykFeeEntry[] | null;
    launch_data: LaunchDataArgs;
    first_buy: string | null;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (tokenId: string) => void;
  }

  let { isOpen, onClose, onSuccess }: Props = $props();

  const chatwootModalVisibility = createChatwootModalVisibilityController();
  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });
  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  let modalRef = $state<HTMLDivElement | null>(null);
  let previouslyFocusedElement: HTMLElement | null = null;

  $effect(() => {
    if (!isOpen) return;

    previouslyFocusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    queueMicrotask(() => {
      if (modalRef) focusFirstElement(modalRef);
    });

    return () => {
      previouslyFocusedElement?.focus();
      previouslyFocusedElement = null;
    };
  });

  const accountId = $derived($walletStore.accountId);

  let name = $state("");
  let symbol = $state("");
  let iconDataUrl = $state<string | null>(null);
  let iconError = $state<string | null>(null);
  let shortId = $state(false);
  let totalSupplyInput = $state(DEFAULT_TOTAL_SUPPLY);
  let description = $state("");
  let telegram = $state("");
  let x = $state("");
  let website = $state("");
  let firstBuy = $state("");

  function buildDefaultFeeReceivers(
    connectedAccountId: string | null,
  ): FeeReceiverDraft[] {
    if (connectedAccountId) {
      return [
        {
          receiver: { Account: connectedAccountId },
          amount: { kind: "fixed", percentage: "1" },
        },
      ];
    }
    return [];
  }

  let feeReceivers = $state<FeeReceiverDraft[]>(buildDefaultFeeReceivers(null));
  let isFeeValid = $state(true);
  let hasDuplicateReceivers = $state(false);
  let areAllReceiversValid = $state(true);
  let hasScheduledDurationError = $state(false);
  let hasScheduledFeeDirectionError = $state(false);

  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let showErrorModal = $state(false);
  let txError = $state<string | null>(null);

  const isNameValid = $derived(name.length > 0);
  const isSymbolValid = $derived(symbol.length > 0);
  const isDescriptionValid = $derived(description.length <= 200);
  const isTelegramValid = $derived.by(() => {
    if (telegram.length === 0) return true;
    if (telegram.length > 50) return false;
    return /^https:\/\/t\.me\/[^/]+$/.test(telegram);
  });
  const isXValid = $derived.by(() => {
    if (x.length === 0) return true;
    if (x.length > 50) return false;
    return /^https:\/\/x\.com\/[^/]+$/.test(x);
  });
  const isWebsiteValid = $derived.by(() => {
    if (website.length === 0) return true;
    if (website.length > 50) return false;
    return website.startsWith("https://");
  });

  function parseOptionalNearToYocto(input: string): bigint | null {
    if (!input) return 0n;
    if (input.startsWith("-")) return null;
    if (!/^\d*\.?\d*$/.test(input) || input === ".") return null;
    const parsed = parseFloat(input);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return BigInt(humanReadableToRawAmount(input, NEAR_DECIMALS));
  }

  function parseTotalSupplyUnits(input: string): bigint | null {
    if (!/^\d+$/.test(input)) return null;
    try {
      return BigInt(input);
    } catch {
      return null;
    }
  }

  const firstBuyYocto = $derived.by(() => parseOptionalNearToYocto(firstBuy));
  const isFirstBuyValid = $derived(firstBuyYocto !== null);

  const totalSupplyUnits = $derived.by(() =>
    parseTotalSupplyUnits(totalSupplyInput),
  );
  const isTotalSupplyValid = $derived.by(
    () =>
      totalSupplyUnits !== null &&
      totalSupplyUnits >= MIN_TOTAL_SUPPLY &&
      totalSupplyUnits <= MAX_TOTAL_SUPPLY,
  );
  const totalSupplyRaw = $derived.by(() =>
    isTotalSupplyValid && totalSupplyUnits !== null
      ? (totalSupplyUnits * ONE_NEAR_YOCTO).toString()
      : null,
  );

  const iconLength = $derived(iconDataUrl?.length ?? 0);
  const bytesNeeded = $derived(
    symbol.length + name.length + iconLength + BYTES_OVERHEAD,
  );
  const storageCostYocto = $derived(BigInt(bytesNeeded) * COST_PER_BYTE_YOCTO);
  const shortCaCostYocto = $derived(shortId ? ONE_NEAR_YOCTO : 0n);
  const creationCostYocto = $derived(storageCostYocto + shortCaCostYocto);
  const symbolForCa = $derived.by(() => symbol.toLowerCase());
  const shortCa = $derived.by(() =>
    symbolForCa.length > 0 ? `${symbolForCa}.${LAUNCH_CONTRACT_ID}` : "",
  );
  const longCa = $derived.by(() => {
    if (symbolForCa.length === 0) return "";
    let suffix = 1;
    let potentialTokenId = `${symbolForCa}-${suffix}.${LAUNCH_CONTRACT_ID}`;
    while ($tokenHubStore.tokensById[potentialTokenId]) {
      suffix += 1;
      potentialTokenId = `${symbolForCa}-${suffix}.${LAUNCH_CONTRACT_ID}`;
    }
    return potentialTokenId;
  });
  const caPreviewTokenId = $derived(shortId ? shortCa : longCa);
  const totalDepositYocto = $derived.by(() => {
    const firstBuyPart = firstBuyYocto ?? 0n;
    return creationCostYocto + firstBuyPart;
  });
  const requiredNearWithGasYocto = $derived(
    totalDepositYocto + GAS_RESERVE_NEAR,
  );
  const nearBalanceYocto = $derived.by(() => {
    const raw = $tokenHubStore.tokensById["near"]?.balance;
    if (!raw) return 0n;
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  });
  const hasInsufficientNearBalance = $derived(
    nearBalanceYocto < requiredNearWithGasYocto,
  );

  const shortCaTokenExists = $derived.by(() => {
    if (!shortCa) return false;
    return tokenHubStore.selectToken(shortCa) !== null;
  });

  const validationErrors = $derived.by(() => {
    const errors: string[] = [];
    if (!isNameValid) errors.push("Name is required");
    if (!isSymbolValid) errors.push("Ticker is required");
    if (!iconDataUrl) errors.push("Icon is required");
    if (!isTotalSupplyValid) {
      errors.push(
        "Total supply must be an integer between 1,000 and 1,000,000,000,000,000,000",
      );
    }
    if (!isDescriptionValid)
      errors.push("Description must be 200 characters or fewer");
    if (!isTelegramValid) {
      errors.push(
        "Telegram must start with https://t.me/ and be a valid link to a chat",
      );
    }
    if (!isXValid) {
      errors.push(
        "X must start with https://x.com/ and be a valid link to a profile",
      );
    }
    if (!isWebsiteValid) errors.push("Website must start with https://");
    if (!isFirstBuyValid) errors.push("First buy must be a number");
    if (hasInsufficientNearBalance) {
      errors.push(
        "Insufficient NEAR balance for total + 0.03 NEAR gas reserve",
      );
    }
    if (!isFeeValid) errors.push("Total fee must be less than 50%");
    if (hasDuplicateReceivers)
      errors.push("Duplicate fee receivers are not allowed");
    if (!areAllReceiversValid) errors.push("Invalid fee receiver");
    if (hasScheduledDurationError)
      errors.push("Scheduled fee duration must be set");
    if (hasScheduledFeeDirectionError) {
      errors.push("Scheduled fee end must be lower than start");
    }
    if (shortId && shortCaTokenExists) {
      errors.push(`Token ${shortCa} already exists`);
    }
    return errors;
  });

  const isFormValid = $derived(validationErrors.length === 0);

  function formatNearYocto(yocto: bigint): string {
    return rawAmountToHumanReadable(yocto.toString(), NEAR_DECIMALS);
  }

  function formatOptionalNearCost(yocto: bigint): string {
    if (yocto === 0n) return "Not Included";
    return `${formatNearYocto(yocto)} NEAR`;
  }

  async function fileToImage(file: File): Promise<HTMLImageElement> {
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Unable to load selected image"));
      };
      img.src = objectUrl;
    });
  }

  async function compressIcon(file: File): Promise<string> {
    const image = await fileToImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to initialize image processor");
    }

    const scale = Math.max(ICON_SIZE / image.width, ICON_SIZE / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = (ICON_SIZE - drawWidth) / 2;
    const drawY = (ICON_SIZE - drawHeight) / 2;

    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    const webpDataUrl = canvas.toDataURL("image/webp", ICON_QUALITY);
    if (!webpDataUrl.startsWith("data:image/webp;base64,")) {
      throw new Error("Failed to convert icon to WebP");
    }
    return webpDataUrl;
  }

  async function handleIconFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    iconError = null;
    submitError = null;
    try {
      iconDataUrl = await compressIcon(file);
    } catch (error) {
      iconDataUrl = null;
      iconError =
        error instanceof Error
          ? error.message
          : "Failed to process selected icon";
    } finally {
      input.value = "";
    }
  }

  function clearIcon(): void {
    iconDataUrl = null;
    iconError = null;
  }

  function handleFeeEditorChange(state: FeeReceiversEditorState): void {
    feeReceivers = state.receivers;
    isFeeValid = state.isFeeValid;
    hasDuplicateReceivers = state.hasDuplicateReceivers;
    areAllReceiversValid = state.areAllReceiversValid;
    hasScheduledDurationError = state.hasScheduledDurationError;
    hasScheduledFeeDirectionError = state.hasScheduledFeeDirectionError;
  }

  function toLaunchFeeAmount(draft: FeeAmountDraft): XykFeeAmount | null {
    const schemaAmount = draftAmountToSchemaXykFeeAmount(draft);
    if (!schemaAmount) return null;

    if ("Fixed" in schemaAmount) {
      return { Fixed: schemaAmount.Fixed };
    }
    if ("Scheduled" in schemaAmount) {
      return {
        Scheduled: {
          start: [
            schemaAmount.Scheduled.start.timestampNanos,
            schemaAmount.Scheduled.start.feeFraction,
          ],
          end: [
            schemaAmount.Scheduled.end.timestampNanos,
            schemaAmount.Scheduled.end.feeFraction,
          ],
          curve: "Linear",
        },
      };
    }
    return {
      Dynamic: {
        min: schemaAmount.Dynamic.min,
        max: schemaAmount.Dynamic.max,
      },
    };
  }

  function toLaunchFeeEntries(receivers: FeeReceiverDraft[]): XykFeeEntry[] {
    return receivers.flatMap((item) => {
      const amount = toLaunchFeeAmount(item.amount);
      if (!amount) return [];

      if (item.receiver === "Pool") {
        return [["Pool", amount]];
      }
      const account = item.receiver.Account;
      if (!account) return [];
      return [[{ Account: account }, amount]] as XykFeeEntry[];
    });
  }

  function getSuccessValue(status: { SuccessValue?: string }): string | null {
    return status.SuccessValue ?? null;
  }

  function parseTokenIdFromSuccessValue(successValue: string): string | null {
    try {
      return JSON.parse(atob(successValue));
    } catch {
      return null;
    }
  }

  function extractLaunchedTokenId(
    outcomes: FinalExecutionOutcome[],
  ): string | null {
    const firstOutcome = outcomes[0];
    const receipts = firstOutcome.receipts_outcome;
    const firstReceipt = receipts[0];
    const status = firstReceipt.outcome.status;
    const successValue = getSuccessValue(status);
    return successValue !== null
      ? parseTokenIdFromSuccessValue(successValue)
      : null;
  }

  function normalizeOptional(value: string): string | null {
    return value.length === 0 ? null : value;
  }

  function handleNumericInput(
    event: Event & { currentTarget: EventTarget & HTMLInputElement },
    field: "totalSupplyInput" | "firstBuy",
  ): void {
    const nextValue = event.currentTarget.value.trim();
    if (field === "totalSupplyInput") {
      totalSupplyInput = nextValue;
      return;
    }
    firstBuy = nextValue;
  }

  async function handleLaunch(): Promise<void> {
    if (!isFormValid) {
      submitError = "Please fix validation errors before launching";
      return;
    }

    const wallet = $walletStore.wallet;
    if (!wallet) {
      txError = "Please connect your wallet";
      showErrorModal = true;
      return;
    }
    if (
      firstBuyYocto === null ||
      totalSupplyRaw === null ||
      iconDataUrl === null
    ) {
      submitError = "Invalid launch payload";
      return;
    }

    isSubmitting = true;
    submitError = null;

    try {
      const fees = toLaunchFeeEntries(feeReceivers);
      const launchData: LaunchDataArgs = {
        telegram: normalizeOptional(telegram),
        x: normalizeOptional(x),
        website: normalizeOptional(website),
        description: normalizeOptional(description),
      };
      const hasFirstBuy = firstBuy.length > 0;
      const args: LaunchTokenArgs = {
        name,
        symbol,
        icon: iconDataUrl,
        decimals: NEAR_DECIMALS,
        total_supply: totalSupplyRaw,
        short_id: shortId,
        fees: fees.length > 0 ? fees : null,
        launch_data: launchData,
        first_buy: hasFirstBuy ? firstBuyYocto.toString() : null,
      };

      const transactions = [
        {
          receiverId: LAUNCH_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall" as const,
              params: {
                methodName: "launch_token",
                args,
                gas: "300" + "0".repeat(12), // 300 TGas
                deposit: totalDepositYocto.toString(),
              },
            },
          ],
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);
      const tokenId = extractLaunchedTokenId(outcomes);
      if (!tokenId) {
        throw new Error(
          "Launch transaction succeeded but token ID was not returned in SuccessValue",
        );
      }
      onSuccess(tokenId);
      onClose();
    } catch (error) {
      txError =
        error instanceof Error ? error.message : "Failed to launch token";
      showErrorModal = true;
    } finally {
      isSubmitting = false;
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose();
    }
  }

  function handleModalKeyDown(event: KeyboardEvent): void {
    if (!modalRef) return;

    if (event.key === "Escape" && !isSubmitting) {
      event.stopPropagation();
      onClose();
      return;
    }

    trapFocusKeydown(event, modalRef);
  }

  function handleBackdropKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !isSubmitting) {
      onClose();
    }
  }

  $effect(() => {
    if (!isOpen) {
      name = "";
      symbol = "";
      iconDataUrl = null;
      iconError = null;
      shortId = false;
      totalSupplyInput = DEFAULT_TOTAL_SUPPLY;
      description = "";
      telegram = "";
      x = "";
      website = "";
      firstBuy = "";
      feeReceivers = buildDefaultFeeReceivers(accountId);
      isFeeValid = true;
      hasDuplicateReceivers = false;
      areAllReceiversValid = true;
      hasScheduledDurationError = false;
      hasScheduledFeeDirectionError = false;
      submitError = null;
      isSubmitting = false;
      iconError = null;
      txError = null;
      showErrorModal = false;
    }
  });
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleBackdropKeyDown}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal"
      bind:this={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-token-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={handleModalKeyDown}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <div class="modal-header">
        <h2 id="create-token-title">Create Token</h2>
        <button
          class="close-btn"
          onclick={onClose}
          aria-label="Close"
          disabled={isSubmitting}
        >
          <X size={20} />
        </button>
      </div>

      <div class="modal-body">
        <div class="section two-cols">
          <label class="field">
            <span class="field-label">Ticker</span>
            <input
              type="text"
              placeholder="BTC"
              bind:value={symbol}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <label class="field">
            <span class="field-label">Name</span>
            <input
              type="text"
              placeholder="Bitcoin"
              bind:value={name}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        </div>

        <div class="section">
          <div class="section-head-row">
            <span class="field-label">Icon</span>
          </div>
          <div class="icon-row">
            {#if iconDataUrl}
              <img
                src={iconDataUrl}
                alt="Token icon preview"
                class="icon-preview"
              />
            {:else}
              <div class="icon-placeholder">Icon</div>
            {/if}
            <label class="icon-upload-btn">
              <Upload size={14} />
              <span>Upload image</span>
              <input
                type="file"
                accept="image/*"
                onchange={handleIconFileChange}
              />
            </label>
            {#if iconDataUrl}
              <button type="button" class="icon-remove-btn" onclick={clearIcon}
                >Remove</button
              >
            {/if}
          </div>
          {#if iconError}
            <p class="icon-error">{iconError}</p>
          {/if}
        </div>

        <div class="section">
          <label class="switch-row">
            <input type="checkbox" bind:checked={shortId} />
            <span>Short CA</span>
          </label>
          {#if caPreviewTokenId}
            <p class="ca-preview">
              <span class="field-label">Preview</span>
              <code>{caPreviewTokenId}</code>
            </p>
          {/if}
        </div>

        <div class="section">
          <label class="field">
            <span class="field-label">Total supply</span>
            <input
              type="text"
              inputmode="numeric"
              placeholder="1000000000"
              value={totalSupplyInput}
              oninput={(event) => handleNumericInput(event, "totalSupplyInput")}
              spellcheck="false"
            />
          </label>
        </div>

        <LaunchDataFields bind:description bind:telegram bind:x bind:website />

        <div class="section">
          <label class="field">
            <span class="field-label">First buy (NEAR)</span>
            <input
              type="text"
              inputmode="decimal"
              placeholder="0"
              value={firstBuy}
              oninput={(event) => handleNumericInput(event, "firstBuy")}
            />
          </label>
        </div>

        <FeeReceiversEditor
          {accountId}
          initialReceivers={buildDefaultFeeReceivers(accountId)}
          onChange={handleFeeEditorChange}
        />

        <div class="cost-box">
          <div class="cost-row">
            <span>Storage</span>
            <strong>{formatNearYocto(storageCostYocto)} NEAR</strong>
          </div>
          <div class="cost-row">
            <span>Short CA</span>
            <strong>{formatOptionalNearCost(shortCaCostYocto)}</strong>
          </div>
          <div class="cost-row">
            <span>First buy</span>
            <strong
              >{firstBuyYocto !== null
                ? formatOptionalNearCost(firstBuyYocto)
                : "Invalid Number"}</strong
            >
          </div>
          <div class="cost-row total">
            <span>Total</span>
            <strong>{formatNearYocto(totalDepositYocto)} NEAR</strong>
          </div>
        </div>
      </div>

      {#if validationErrors.length > 0 || submitError}
        <div class="form-errors" role="alert" aria-live="assertive">
          {#if submitError}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>{submitError}</span>
            </div>
          {/if}
          {#each validationErrors as errorMessage (errorMessage)}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>{errorMessage}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="cancel-btn" onclick={onClose} disabled={isSubmitting}
          >Cancel</button
        >
        <button
          class="launch-btn"
          onclick={handleLaunch}
          disabled={!isFormValid || isSubmitting || hasInsufficientNearBalance}
        >
          {#if isSubmitting}
            <LoaderCircle size={16} class="spinning" />
            Launching...
          {:else}
            Launch
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<ErrorModal
  isOpen={showErrorModal}
  onClose={() => {
    showErrorModal = false;
    txError = null;
  }}
  title="Create Token Failed"
  message={txError ?? ""}
  isTransaction={true}
/>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    width: 100%;
    max-width: 560px;
    max-height: 92vh;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .close-btn:hover:not(:disabled) {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .two-cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
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

  .field input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    color: var(--text-primary);
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
  }

  .field input:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
  }

  .section-head-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .icon-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .icon-preview,
  .icon-placeholder {
    width: 72px;
    height: 72px;
    border-radius: 0.625rem;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
    object-fit: cover;
    object-position: center;
  }

  .icon-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--bg-input);
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
  }

  .icon-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.75rem;
    border-radius: 0.55rem;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .icon-upload-btn input {
    display: none;
  }

  .icon-remove-btn {
    padding: 0.55rem 0.75rem;
    border-radius: 0.55rem;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .icon-error {
    margin: 0;
    color: var(--status-error-text);
    font-size: 0.8rem;
  }

  .switch-row {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
    user-select: none;
  }

  .switch-row input {
    margin: 0;
    accent-color: var(--accent-primary);
  }

  .ca-preview {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .ca-preview code {
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    word-break: break-all;
  }

  .cost-box {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    border: 1px solid var(--border-color);
    border-radius: 0.7rem;
    background: var(--bg-input);
    padding: 0.75rem;
  }

  .cost-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .cost-row strong {
    font-size: 0.84rem;
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
    text-align: right;
    word-break: break-all;
  }

  .cost-row.total {
    margin-top: 0.2rem;
    padding-top: 0.45rem;
    border-top: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .form-errors {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.75rem 1rem;
    background: var(--status-error-soft-bg);
    border: 1px solid var(--status-error-soft-border);
    border-radius: 0.625rem;
    margin: 0.6rem 1.5rem 0.75rem;
  }

  .form-error {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    color: var(--status-error-text);
    font-size: 0.8rem;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1.15rem 1.5rem;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .cancel-btn,
  .launch-btn {
    flex: 1;
    padding: 0.8rem 1.25rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .cancel-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .cancel-btn:hover:not(:disabled) {
    background: var(--bg-input);
    border-color: var(--text-muted);
  }

  .launch-btn {
    background: var(--accent-button-small);
    border: none;
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .launch-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .launch-btn:disabled,
  .cancel-btn:disabled,
  .close-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .launch-btn :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (--tablet) {
    .modal-backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .modal {
      max-width: 100%;
      max-height: 95vh;
      border-radius: 1.25rem 1.25rem 0 0;
      border-bottom: none;
    }

    .modal-header,
    .modal-footer {
      padding-left: 1.25rem;
      padding-right: 1.25rem;
    }

    .modal-body {
      padding: 1rem 1.25rem;
    }

    .modal-footer {
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }
  }

  @media (--mobile) {
    .two-cols {
      grid-template-columns: 1fr;
    }
  }
</style>
