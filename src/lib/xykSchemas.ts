import { type Schema, serialize } from "borsh";
import type { XykFeeAmount } from "./types";

const AccountIdSchema: Schema = "string";

export const AssetIdSchema: Schema = {
  enum: [
    { struct: { Near: { struct: {} } } },
    { struct: { Nep141: AccountIdSchema } },
    { struct: { Nep245: { array: { type: "string", len: 2 } } } },
    { struct: { Nep171: { array: { type: "string", len: 2 } } } },
  ],
};

export type SchemaAssetId =
  | { Near: {} }
  | { Nep141: string }
  | { Nep245: [string, string] }
  | { Nep171: [string, string] };

export function assetId(
  type: "Near" | "Nep141" | "Nep245" | "Nep171",
  contractId?: string,
  tokenId?: string,
): SchemaAssetId {
  switch (type) {
    case "Near":
      return { Near: {} };
    case "Nep141":
      if (!contractId) throw new Error("Contract ID is required for Nep141");
      return { Nep141: contractId };
    case "Nep245":
      if (!contractId || !tokenId)
        throw new Error("Contract ID and token ID are required for Nep245");
      return { Nep245: [contractId, tokenId] };
    case "Nep171":
      if (!contractId || !tokenId)
        throw new Error("Contract ID and token ID are required for Nep171");
      return { Nep171: [contractId, tokenId] };
  }
}

export type SchemaXykFeeReceiver = { Account: string } | { Pool: {} };

export const XykFeeReceiverSchema: Schema = {
  enum: [
    { struct: { Account: AccountIdSchema } },
    { struct: { Pool: { struct: {} } } },
  ],
};

const XykScheduledFeeCurveSchema: Schema = {
  enum: [{ struct: { Linear: { struct: {} } } }],
};

const XykFeeFractionSchema: Schema = "u32";

const XykFeePointSchema: Schema = {
  struct: {
    timestampNanos: "u64",
    feeFraction: XykFeeFractionSchema,
  },
};

const XykFeeAmountSchema: Schema = {
  enum: [
    { struct: { Fixed: XykFeeFractionSchema } },
    {
      struct: {
        Scheduled: {
          struct: {
            start: XykFeePointSchema,
            end: XykFeePointSchema,
            curve: XykScheduledFeeCurveSchema,
          },
        },
      },
    },
    {
      struct: {
        Dynamic: {
          struct: { min: XykFeeFractionSchema, max: XykFeeFractionSchema },
        },
      },
    },
  ],
};

const XykCurrentFeesSchema: Schema = {
  struct: {
    receivers: {
      array: {
        type: {
          struct: {
            receiver: XykFeeReceiverSchema,
            amount: XykFeeFractionSchema,
          },
        },
      },
    },
  },
};

const XykV2FeeConfigurationSchema: Schema = {
  struct: {
    receivers: {
      array: {
        type: {
          struct: {
            receiver: XykFeeReceiverSchema,
            amount: XykFeeAmountSchema,
          },
        },
      },
    },
  },
};

export const XykFeeConfigurationSchema: Schema = {
  enum: [
    { struct: { V1: XykCurrentFeesSchema } },
    { struct: { V2: XykV2FeeConfigurationSchema } },
  ],
};

export type SchemaXykPoolType =
  | { PrivateLatest: {} }
  | { PublicLatest: {} }
  | { LaunchLatest: { phantom_liquidity_near: bigint } }
  | { LaunchV1: { phantom_liquidity_near: bigint } }
  | { PrivateV1: {} }
  | { PublicV1: {} }
  | { PrivateV2: {} }
  | { PublicV2: {} };

const XykPoolTypeSchema: Schema = {
  enum: [
    { struct: { PrivateLatest: { struct: {} } } },
    { struct: { PublicLatest: { struct: {} } } },
    {
      struct: { LaunchLatest: { struct: { phantom_liquidity_near: "u128" } } },
    },
    { struct: { LaunchV1: { struct: { phantom_liquidity_near: "u128" } } } },
    { struct: { PrivateV1: { struct: {} } } },
    { struct: { PublicV1: { struct: {} } } },
    { struct: { PrivateV2: { struct: {} } } },
    { struct: { PublicV2: { struct: {} } } },
  ],
};

const AssetPairSchema: Schema = { array: { type: AssetIdSchema, len: 2 } };

export const XykCreatePoolArgsSchema: Schema = {
  struct: {
    assets: AssetPairSchema,
    fees: XykFeeConfigurationSchema,
    pool_type: XykPoolTypeSchema,
  },
};

export interface ArgsXykCreatePool {
  assets: [SchemaAssetId, SchemaAssetId];
  fees: SchemaXykFeeConfiguration;
  pool_type: SchemaXykPoolType;
}

export type SchemaXykFeeConfiguration =
  | {
      V1: SchemaXykCurrentFees;
    }
  | {
      V2: SchemaXykFeeConfigurationV2;
    };

export type SchemaXykCurrentFees = {
  receivers: {
    receiver: SchemaXykFeeReceiver;
    amount: number;
  }[];
};

export type SchemaXykFeeConfigurationV2 = {
  receivers: {
    receiver: SchemaXykFeeReceiver;
    amount: XykFeeAmount;
  }[];
};

export const XykGetPendingFeesArgsSchema: Schema = {
  struct: {
    account_id: AccountIdSchema,
    asset_ids: { array: { type: AssetIdSchema } },
  },
};

export interface ArgsXykGetPendingFees {
  account_id: string;
  asset_ids: SchemaAssetId[];
}

export const XykWithdrawFeesArgsSchema: Schema = {
  struct: {
    assets: { array: { type: AssetIdSchema } },
  },
};

export interface ArgsXykWithdrawFees {
  assets: SchemaAssetId[];
}

const XykPoolIdSchema: Schema = "u32";

export const XykUpgradePoolArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
  },
};

export interface ArgsXykUpgradePool {
  pool_id: number;
}

export const XykSwapArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
  },
};

export interface ArgsXykSwap {
  pool_id: number;
}

export const XykPoolNeedsUpgradeArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
  },
};

export interface ArgsXykPoolNeedsUpgrade {
  pool_id: number;
}

const OptionU128Schema: Schema = { option: "u128" };

export const XykAddLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
    min_shares_received: OptionU128Schema,
  },
};

export interface ArgsXykAddLiquidity {
  pool_id: number;
  min_shares_received: bigint | null;
}

const U128PairSchema: Schema = {
  array: { type: "u128", len: 2 },
};
const OptionU128PairSchema: Schema = { option: U128PairSchema };

export const XykRemoveLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
    shares_to_remove: OptionU128Schema,
    min_assets_received: OptionU128PairSchema,
  },
};

export interface ArgsXykRemoveLiquidity {
  pool_id: number;
  shares_to_remove: bigint | null;
  min_assets_received: [bigint, bigint] | null;
}

export const XykEditFeesArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
    fees: XykFeeConfigurationSchema,
  },
};

export interface ArgsXykEditFees {
  pool_id: number;
  fees: SchemaXykFeeConfiguration;
}

export const XykLockPoolArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
  },
};

export interface ArgsXykLockPool {
  pool_id: number;
}

export const XykRegisterLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: XykPoolIdSchema,
  },
};

export interface ArgsXykRegisterLiquidity {
  pool_id: number;
}

export function serializeToBase64(schema: Schema, data: unknown): string {
  const buffer = serialize(schema, data);
  return btoa(String.fromCharCode(...buffer));
}
