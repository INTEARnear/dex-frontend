import { viewFunction } from "../utils";
import type { LaunchInfo } from "./types";

/** Factory used for all new launches. Its tokens share NEAR fees with holders. */
export const LAUNCH_CONTRACT_ID = "launch-v2.intear.near";
/** Previous factory. Its tokens are still listed and editable, but no longer launched. */
export const LEGACY_LAUNCH_CONTRACT_ID = "launch.intear.near";

export function isLaunchV2Token(tokenAccountId: string): boolean {
  return tokenAccountId.endsWith(`.${LAUNCH_CONTRACT_ID}`);
}

export function isLaunchToken(tokenAccountId: string): boolean {
  return (
    isLaunchV2Token(tokenAccountId) ||
    tokenAccountId.endsWith(`.${LEGACY_LAUNCH_CONTRACT_ID}`)
  );
}

export function getLaunchContractId(tokenAccountId: string): string {
  return isLaunchV2Token(tokenAccountId)
    ? LAUNCH_CONTRACT_ID
    : LEGACY_LAUNCH_CONTRACT_ID;
}

/** Reads description, social links and creator of a launched token from its factory. */
export function fetchLaunchInfo(
  tokenAccountId: string,
): Promise<LaunchInfo | null> {
  return viewFunction<LaunchInfo | null>(
    getLaunchContractId(tokenAccountId),
    "get_launch_data",
    { token_account_id: tokenAccountId },
  );
}
