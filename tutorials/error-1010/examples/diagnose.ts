/**
 * Error 1010 Diagnostic Utility
 *
 * Classifies and provides actionable guidance for Error 1010 variants
 * on the Midnight Network.
 *
 * Usage:
 *   import { diagnoseError1010, ErrorVariant } from './diagnose';
 *
 *   try {
 *     await wallet.submitTransaction(tx);
 *   } catch (error) {
 *     const diagnosis = diagnoseError1010(error);
 *     console.log(diagnosis.message);
 *     console.log(diagnosis.suggestedFix);
 *   }
 */

// ============================================================
// Types
// ============================================================

export enum ErrorVariant {
  /** Client-side: transaction builder could not construct valid tx */
  MALFORMED_TRANSACTION = 139,

  /** Server-side: transaction exceeds block resource limits */
  BLOCK_LIMIT_EXCEEDED = 154,

  /** Server-side: batch segment ordering conflict */
  BATCH_SETTLEMENT_FAILURE = 168,

  /** Server-side: Merkle root has been pruned */
  MERKLE_ROOT_PRUNING = 170,

  /** Server-side: effects consistency check failed */
  EFFECTS_CHECK_FAILURE = 186,
}

export interface Diagnosis {
  /** The raw error code (always 1010) */
  code: number;

  /** The inner variant code */
  variant: number | null;

  /** Human-readable name of the variant */
  variantName: string;

  /** Category: 'client' or 'server' */
  category: "client" | "server";

  /** Plain-language explanation */
  message: string;

  /** Actionable fix steps */
  suggestedFix: string[];

  /** Whether the error is retryable */
  retryable: boolean;

  /** Whether the transaction should be rebuilt */
  rebuildRequired: boolean;
}

// ============================================================
// Variant Metadata
// ============================================================

interface VariantInfo {
  name: string;
  category: "client" | "server";
  message: string;
  suggestedFix: string[];
  retryable: boolean;
  rebuildRequired: boolean;
}

const VARIANT_MAP: Record<number, VariantInfo> = {
  [ErrorVariant.MALFORMED_TRANSACTION]: {
    name: "MalformedTransaction",
    category: "client",
    message:
      "The transaction builder could not construct a valid transaction. " +
      "This is a client-side error — the transaction never reached the network. " +
      "Common causes: mismatched ABI types, unbalanced token amounts, invalid nonce, or malformed ZK proof data.",
    suggestedFix: [
      "Check the transaction builder's error output for the specific malformed field",
      "Verify circuit arguments match the compiled ABI (run compactc --check)",
      "Log each step of transaction construction to find where it fails",
      "Ensure token inputs equal outputs for all segments",
      "Verify nonce and TTL values are valid",
    ],
    retryable: false,
    rebuildRequired: true,
  },

  [ErrorVariant.BLOCK_LIMIT_EXCEEDED]: {
    name: "BlockLimitExceeded",
    category: "server",
    message:
      "The transaction exceeds one or more of the block's resource limits. " +
      "Midnight enforces limits across 5 dimensions: compute time, I/O read time, " +
      "consensus throughput, persistent storage, and churn. " +
      "Exceeding any single dimension triggers this error.",
    suggestedFix: [
      "Reduce the number of operations in this transaction",
      "Chunk large batches into smaller transactions (3-5 recipients each)",
      "Move heavy computation off-chain, submit only the proof",
      "Reduce state writes — each write consumes persistent storage budget",
      "Profile with: RUST_LOG=midnight_ledger=debug to find the limiting dimension",
    ],
    retryable: false,
    rebuildRequired: true,
  },

  [ErrorVariant.BATCH_SETTLEMENT_FAILURE]: {
    name: "BatchSettlementFailure",
    category: "server",
    message:
      "A batch transaction failed due to segment ordering conflicts. " +
      "Midnight transactions can contain multiple segments (guaranteed + fallible), " +
      "and the ledger enforces strict causal precedence between them.",
    suggestedFix: [
      "Simplify to a single segment if possible",
      "Ensure guaranteed segments do not conflict with fallible segments on the same contract",
      "Check for overlapping nullifiers across ZSwap offers in different segments",
      "Review the transaction builder's validation output for the conflicting segment pair",
    ],
    retryable: false,
    rebuildRequired: true,
  },

  [ErrorVariant.MERKLE_ROOT_PRUNING]: {
    name: "MerkleRootPruning",
    category: "server",
    message:
      "The transaction references a Merkle root that has been pruned from the node's storage. " +
      "Midnight nodes maintain a finite window of historical state (typically 2400 blocks). " +
      "Proofs anchored to roots outside this window cannot be verified.",
    suggestedFix: [
      "Regenerate the ZK proof against the current ledger state",
      "Check proof age: current_block - root_block must be < BlockHashCount (2400)",
      "Implement a TTL check for cached proofs — regenerate if approaching the pruning window",
      "Never cache proofs for more than ~1000 blocks",
    ],
    retryable: true,
    rebuildRequired: true,
  },

  [ErrorVariant.EFFECTS_CHECK_FAILURE]: {
    name: "EffectsCheckFailure",
    category: "server",
    message:
      "The transaction's effects mapping failed the ledger's consistency check. " +
      "This can be caused by nullifier collisions, mismatched Pedersen commitments, " +
      "unbalanced segments, or double-spend attempts.",
    suggestedFix: [
      "Refresh wallet state (syncState) to get the latest nullifier set",
      "Check for nullifier collisions — ensure no two operations consume the same nullifier",
      "Verify Pedersen commitments are correctly formed",
      "Isolate the failing component by removing operations one at a time",
      "Enable debug logging: RUST_LOG=midnight_ledger=debug",
    ],
    retryable: true,
    rebuildRequired: true,
  },
};

// ============================================================
// Diagnostic Function
// ============================================================

/**
 * Analyzes an error object and returns a structured diagnosis for Error 1010.
 *
 * @param error - The error caught from a transaction submission
 * @returns A Diagnosis object with variant info, message, and suggested fixes
 *
 * @example
 * ```typescript
 * try {
 *   const txHash = await wallet.submitTransaction(signedTx);
 * } catch (error) {
 *   const diagnosis = diagnoseError1010(error);
 *
 *   if (diagnosis.code === 1010) {
 *     console.error(`Error 1010 / ${diagnosis.variantName}`);
 *     console.error(`Category: ${diagnosis.category}`);
 *     console.error(`Message: ${diagnosis.message}`);
 *     console.error("Suggested fixes:");
 *     diagnosis.suggestedFix.forEach((fix, i) => console.error(`  ${i + 1}. ${fix}`));
 *     console.error(`Retryable: ${diagnosis.retryable}`);
 *     console.error(`Rebuild required: ${diagnosis.rebuildRequired}`);
 *   }
 * }
 * ```
 */
export function diagnoseError1010(error: any): Diagnosis {
  // Extract error code and inner variant
  const code = extractErrorCode(error);
  const variant = extractVariant(error);

  // Not an Error 1010
  if (code !== 1010) {
    return {
      code,
      variant,
      variantName: "NotError1010",
      category: "server",
      message: `Error ${code} is not Error 1010. This diagnostic utility handles Error 1010 only.`,
      suggestedFix: ["Check the error code against Midnight's full error catalog"],
      retryable: false,
      rebuildRequired: false,
    };
  }

  // Unknown variant
  if (variant === null || !VARIANT_MAP[variant]) {
    return {
      code: 1010,
      variant,
      variantName: variant !== null ? `Unknown(${variant})` : "Unknown",
      category: "server",
      message:
        `Error 1010 with unknown inner variant${variant !== null ? ` ${variant}` : ""}. ` +
        "Check node logs for the full error chain.",
      suggestedFix: [
        "Enable verbose logging: RUST_LOG=midnight_txpool=debug",
        "Check node output for InvalidTransaction(VariantName)",
        "Consult Midnight documentation for new error variants",
      ],
      retryable: false,
      rebuildRequired: true,
    };
  }

  // Known variant
  const info = VARIANT_MAP[variant];
  return {
    code: 1010,
    variant,
    variantName: info.name,
    category: info.category,
    message: info.message,
    suggestedFix: [...info.suggestedFix],
    retryable: info.retryable,
    rebuildRequired: info.rebuildRequired,
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Extracts the top-level error code from various error formats.
 */
function extractErrorCode(error: any): number {
  // Direct code property
  if (typeof error?.code === "number") return error.code;

  // Polkadot-style error
  if (error?.data?.code) return Number(error.data.code);

  // String parsing fallback
  const message = error?.message || String(error);
  const match = message.match(/error\s*(\d{4})/i);
  if (match) return parseInt(match[1], 10);

  return -1;
}

/**
 * Extracts the inner variant code from the error.
 */
function extractVariant(error: any): number | null {
  // Direct innerCode property
  if (typeof error?.innerCode === "number") return error.innerCode;

  // Variant property
  if (typeof error?.variant === "number") return error.variant;

  // Nested in data
  if (error?.data?.variant) return Number(error.data.variant);

  // String parsing: look for "InvalidTransaction(VariantName)" or numeric variant
  const message = error?.message || String(error);

  // Try "InvalidTransaction(186)" pattern
  const numericMatch = message.match(/InvalidTransaction\((\d+)\)/);
  if (numericMatch) return parseInt(numericMatch[1], 10);

  // Try named variants
  const namedVariants: Record<string, number> = {
    MalformedTransaction: 139,
    BlockLimitExceeded: 154,
    BatchSettlementFailure: 168,
    MerkleRootPruning: 170,
    EffectsCheckFailure: 186,
  };

  for (const [name, code] of Object.entries(namedVariants)) {
    if (message.includes(name)) return code;
  }

  return null;
}

// ============================================================
// Formatting Utilities
// ============================================================

/**
 * Formats a Diagnosis as a human-readable string for console output.
 */
export function formatDiagnosis(diagnosis: Diagnosis): string {
  const lines: string[] = [
    "╔══════════════════════════════════════════════════════════╗",
    "║            Error 1010 Diagnostic Report                 ║",
    "╚══════════════════════════════════════════════════════════╝",
    "",
    `  Code:      ${diagnosis.code}`,
    `  Variant:   ${diagnosis.variant ?? "unknown"} (${diagnosis.variantName})`,
    `  Category:  ${diagnosis.category === "client" ? "Client-side" : "Server-side"}`,
    `  Retryable: ${diagnosis.retryable ? "Yes" : "No"}`,
    `  Rebuild:   ${diagnosis.rebuildRequired ? "Required" : "Not required"}`,
    "",
    "  Description:",
    `    ${diagnosis.message}`,
    "",
    "  Suggested Fixes:",
  ];

  diagnosis.suggestedFix.forEach((fix, i) => {
    lines.push(`    ${i + 1}. ${fix}`);
  });

  lines.push("");
  return lines.join("\n");
}

// ============================================================
// Example Usage
// ============================================================

/**
 * Example: Diagnose an error in a transaction submission flow.
 *
 * This function demonstrates the recommended error handling pattern
 * for Midnight dApp development.
 */
export async function exampleSubmissionFlow(
  wallet: any,
  signedTx: any,
  midnightMcp?: any
): Promise<string | null> {
  // Step 1: Simulate before submitting (if MCP is available)
  if (midnightMcp) {
    const simulation = await midnightMcp.simulateTransaction(signedTx);
    if (simulation.status !== "valid") {
      console.error("Simulation failed before submission:");
      console.error(simulation.error);
      return null;
    }
  }

  // Step 2: Submit with error handling
  try {
    const txHash = await wallet.submitTransaction(signedTx);
    console.log("Transaction accepted:", txHash);
    return txHash;
  } catch (error: any) {
    // Step 3: Diagnose
    const diagnosis = diagnoseError1010(error);

    if (diagnosis.code === 1010) {
      console.error(formatDiagnosis(diagnosis));

      // Step 4: Auto-retry for retryable errors
      if (diagnosis.retryable) {
        console.log("Error is retryable — refreshing state and retrying...");
        await wallet.syncState();
        // Note: In production, you should rebuild the transaction,
        // not resubmit the same one
      }
    } else {
      console.error("Non-1010 error:", error.message);
    }

    return null;
  }
}
