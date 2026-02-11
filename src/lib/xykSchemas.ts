import { Schema, serialize } from "borsh";

const AccountIdSchema: Schema = "string";

export const AssetIdSchema: Schema = {
  enum: [
    { struct: { Near: { struct: {} } } },
    { struct: { Nep141: AccountIdSchema } },
    { struct: { Nep245: { array: { type: "string", len: 2 } } } },
    { struct: { Nep171: { array: { type: "string", len: 2 } } } },
  ],
};

export type AssetId = {
  Near: {};
} | {
  Nep141: string;
} | {
  Nep245: [string, string];
} | {
  Nep171: [string, string];
};

export function assetId(
  type: "Near" | "Nep141" | "Nep245" | "Nep171",
  contractId?: string,
  tokenId?: string,
): AssetId {
  switch (type) {
    case "Near":
      return { Near: {} };
    case "Nep141":
      if (!contractId) {
        throw new Error("Contract ID is required for Nep141");
      }
      return { Nep141: contractId };
    case "Nep245":
      if (!contractId || !tokenId) {
        throw new Error("Contract ID and token ID are required for Nep245");
      }
      return { Nep245: [contractId, tokenId] };
    case "Nep171":
      if (!contractId || !tokenId) {
        throw new Error("Contract ID and token ID are required for Nep171");
      }
      return { Nep171: [contractId, tokenId] };
  }
}

export const XykFeeReceiverSchema: Schema = {
  enum: [
    { struct: { User: AccountIdSchema } },
    { struct: { Pool: { struct: {} } } },
  ],
};

const FeeReceiverEntrySchema: Schema = {
  struct: {
    receiver: XykFeeReceiverSchema,
    fee_fraction: "u32",
  },
};

export const XykFeeConfigurationSchema: Schema = {
  struct: {
    receivers: { array: { type: FeeReceiverEntrySchema } },
  },
};

const AssetPairSchema: Schema = { array: { type: AssetIdSchema, len: 2 } };

export const XykCreatePoolArgsSchema: Schema = {
  struct: {
    assets: AssetPairSchema,
    fees: XykFeeConfigurationSchema,
    is_public: "bool",
  },
};

export interface XykCreatePoolArgs {
  assets: [Record<string, unknown>, Record<string, unknown>];
  fees: {
    receivers: Array<{
      receiver: { User: string } | { Pool: {} };
      fee_fraction: number;
    }>;
  };
  is_public: boolean;
}

export const XykEditFeesArgsSchema: Schema = {
  struct: {
    pool_id: "u32",
    fees: XykFeeConfigurationSchema,
  },
};

export interface XykEditFeesArgs {
  pool_id: number;
  fees: {
    receivers: Array<{
      receiver: { User: string } | { Pool: {} };
      fee_fraction: number;
    }>;
  };
}

export const XykGetPendingFeesArgsSchema: Schema = {
  struct: {
    account_id: AccountIdSchema,
    asset_ids: { array: { type: AssetIdSchema } },
  },
};

export interface XykGetPendingFeesArgs {
  account_id: string;
  asset_ids: Array<Record<string, unknown>>;
}

export const XykWithdrawFeesArgsSchema: Schema = {
  struct: {
    assets: { array: { type: AssetIdSchema } },
  },
};

export interface XykWithdrawFeesArgs {
  assets: Array<Record<string, unknown>>;
}

export const XykSwapArgsSchema: Schema = {
  struct: {
    pool_id: "u32",
  },
};

export interface XykSwapArgs {
  pool_id: number;
}

export const XykRegisterLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: "u32",
  },
};

export interface XykRegisterLiquidityArgs {
  pool_id: number;
}

const OptionU128Schema: Schema = {
  option: "u128",
};

export const XykAddLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: "u32",
    min_shares_received: OptionU128Schema,
  },
};

export interface XykAddLiquidityArgs {
  pool_id: number;
  min_shares_received: bigint | null;
}

const U128PairSchema: Schema = { array: { type: "u128", len: 2 } };

const OptionU128PairSchema: Schema = {
  option: U128PairSchema,
};

export const XykRemoveLiquidityArgsSchema: Schema = {
  struct: {
    pool_id: "u32",
    shares_to_remove: OptionU128Schema,
    min_assets_received: OptionU128PairSchema,
  },
};

export interface XykRemoveLiquidityArgs {
  pool_id: number;
  shares_to_remove: bigint | null;
  min_assets_received: [bigint, bigint] | null;
}

export function serializeToBase64(schema: Schema, data: unknown): string {
  const buffer = serialize(schema, data);
  return btoa(String.fromCharCode(...buffer));
}
