import { parseNep297FromLog } from "./nep297";

export interface ParsedTransferEvent {
  tokenId: string;
  amountRaw: string;
  direction: "in" | "out";
  receiptId: string;
}

export function extractTransfersFromOutcome(
  outcome: any,
  accountId: string,
): ParsedTransferEvent[] {
  const transfers: ParsedTransferEvent[] = [];

  if (!outcome || !outcome.receipts_outcome) {
    return transfers;
  }

  const receiptsMap = new Map<string, any>();
  for (const receipt of outcome.receipts || []) {
    receiptsMap.set(receipt.receipt_id, receipt);
  }

  for (const receiptOutcome of outcome.receipts_outcome) {
    const executorId = receiptOutcome.outcome.executor_id;
    const logs = receiptOutcome.outcome.logs || [];
    const receiptId = receiptOutcome.id;
    const receipt = receiptsMap.get(receiptId);

    for (const log of logs) {
      // NEP-297 + NEP-141
      const eventJson = parseNep297FromLog<any>(log);
      if (
        eventJson?.standard === "nep141" &&
        eventJson.event === "ft_transfer"
      ) {
        for (const data of eventJson.data || []) {
          if (data.new_owner_id === accountId) {
            transfers.push({
              tokenId: executorId,
              amountRaw: data.amount,
              direction: "in",
              receiptId,
            });
          } else if (data.old_owner_id === accountId) {
            transfers.push({
              tokenId: executorId,
              amountRaw: data.amount,
              direction: "out",
              receiptId,
            });
          }
        }
      }

      // Old "Transfer X from Y to Z" format (used by .tkn.near and wrap.near)
      const transferMatch = log.match(
        /Transfer (\d+) from ([\w.\-_]+) to ([\w.\-_]+)/,
      );
      if (transferMatch) {
        const [, amount, from, to] = transferMatch;
        if (to === accountId) {
          transfers.push({
            tokenId: executorId,
            amountRaw: amount,
            direction: "in",
            receiptId,
          });
        } else if (from === accountId) {
          transfers.push({
            tokenId: executorId,
            amountRaw: amount,
            direction: "out",
            receiptId,
          });
        }
      }

      // wrap.near specific format for converting wNEAR <-> NEAR during swap
      if (executorId === "wrap.near") {
        const withdrawMatch = log.match(/Withdraw (\d+) NEAR from ([\w.\-_]+)/);
        if (withdrawMatch) {
          const [, amount, from] = withdrawMatch;
          if (from === accountId) {
            transfers.push({
              tokenId: executorId,
              amountRaw: amount,
              direction: "out",
              receiptId,
            });
          }
        }

        const depositMatch = log.match(/Deposit (\d+) NEAR to ([\w.\-_]+)/);
        if (depositMatch) {
          const [, amount, to] = depositMatch;
          if (to === accountId) {
            transfers.push({
              tokenId: executorId,
              amountRaw: amount,
              direction: "in",
              receiptId,
            });
          }
        }
      }
    }

    // Check for NEAR transfers via deposits in function calls or Transfer actions
    if (receipt && receipt.predecessor_id !== "system") {
      const actions = receipt.receipt?.Action?.actions || [];
      const predecessorId = receipt.predecessor_id;
      const receiverId = receipt.receiver_id;

      for (const action of actions) {
        // User sending NEAR with a function call
        if (
          action.FunctionCall &&
          action.FunctionCall.deposit &&
          action.FunctionCall.deposit !== "0" &&
          action.FunctionCall.deposit !== "1"
        ) {
          if (predecessorId === accountId) {
            transfers.push({
              tokenId: "near",
              amountRaw: action.FunctionCall.deposit,
              direction: "out",
              receiptId,
            });
          }
        }

        // Direct NEAR transfer actions
        if (action.Transfer && action.Transfer.deposit) {
          if (receiverId === accountId) {
            transfers.push({
              tokenId: "near",
              amountRaw: action.Transfer.deposit,
              direction: "in",
              receiptId,
            });
          }
        }
      }
    }
  }

  return transfers;
}

export function extractIncomingTransfersFromOutcomes(
  outcomes: unknown,
  accountId: string,
): ParsedTransferEvent[] {
  if (!Array.isArray(outcomes)) {
    return [];
  }
  return outcomes
    .flatMap((outcome) => extractTransfersFromOutcome(outcome, accountId))
    .filter((transfer) => transfer.direction === "in");
}
