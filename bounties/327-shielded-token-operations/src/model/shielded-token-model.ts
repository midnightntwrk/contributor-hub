// This file is part of midnightntwrk/contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createHash } from "node:crypto";

export type Recipient =
  | { readonly kind: "contract"; readonly value: string }
  | { readonly kind: "publicKey"; readonly value: string }
  | { readonly kind: "burn"; readonly value: string };

export type ShieldedCoinInfo = {
  readonly nonce: string;
  readonly color: string;
  readonly value: bigint;
  readonly recipient: Recipient;
};

export type QualifiedShieldedCoinInfo = ShieldedCoinInfo & {
  readonly mtIndex: bigint;
};

export type ShieldedSendResult = {
  readonly sent: ShieldedCoinInfo;
  readonly change: ShieldedCoinInfo | null;
};

export const CONTRACT_SELF: Recipient = {
  kind: "contract",
  value: hashBytes32("kernel.self"),
};

export const BURN_ADDRESS: Recipient = {
  kind: "burn",
  value: hashBytes32("shieldedBurnAddress"),
};

export function hashBytes32(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `0x${hash.digest("hex")}`;
}

export function publicKey(label: string): Recipient {
  return {
    kind: "publicKey",
    value: hashBytes32("publicKey", label),
  };
}

export function evolveNonce(index: bigint | number, nonce: string): string {
  return hashBytes32("evolveNonce", BigInt(index).toString(), normalizeBytes32(nonce));
}

export function tokenType(domainSep: string, contract = CONTRACT_SELF.value): string {
  return hashBytes32("tokenType", normalizeBytes32(domainSep), contract);
}

export function mintShieldedToken(
  domainSep: string,
  value: bigint | number,
  nonce: string,
  recipient: Recipient = CONTRACT_SELF,
): ShieldedCoinInfo {
  const amount = normalizeAmount(value);
  return {
    nonce: normalizeBytes32(nonce),
    color: tokenType(domainSep),
    value: amount,
    recipient,
  };
}

export function commitCoin(
  coin: ShieldedCoinInfo,
  mtIndex: bigint | number,
): QualifiedShieldedCoinInfo {
  return {
    ...coin,
    mtIndex: BigInt(mtIndex),
  };
}

export function sendShielded(
  input: QualifiedShieldedCoinInfo,
  recipient: Recipient,
  value: bigint | number,
): ShieldedSendResult {
  assertQualified(input);
  return splitCoin(input, recipient, value, "sendShielded");
}

export function sendImmediateShielded(
  input: ShieldedCoinInfo,
  target: Recipient,
  value: bigint | number,
): ShieldedSendResult {
  return splitCoin(input, target, value, "sendImmediateShielded");
}

export function shieldedBurnAddress(): Recipient {
  return BURN_ADDRESS;
}

export class ShieldedTokenHarness {
  private nextMtIndex = 0n;
  readonly domainSep: string;
  totalBurned = 0n;
  mintedOperations = 0;

  constructor(domainSep = hashBytes32("shielded-token:domain")) {
    this.domainSep = domainSep;
  }

  mintToContract(value: bigint | number, nonce: string): ShieldedCoinInfo {
    const coin = mintShieldedToken(this.domainSep, value, nonce, CONTRACT_SELF);
    this.mintedOperations += 1;
    return coin;
  }

  mintWithLocalNonce(value: bigint | number, seed: string, index: bigint | number): ShieldedCoinInfo {
    return this.mintToContract(value, evolveNonce(index, seed));
  }

  commit(coin: ShieldedCoinInfo): QualifiedShieldedCoinInfo {
    const qualified = commitCoin(coin, this.nextMtIndex);
    this.nextMtIndex += 1n;
    return qualified;
  }

  sendCommitted(
    input: QualifiedShieldedCoinInfo,
    recipient: Recipient,
    value: bigint | number,
  ): ShieldedSendResult {
    return sendShielded(input, recipient, value);
  }

  burnCommitted(
    input: QualifiedShieldedCoinInfo,
    value: bigint | number,
  ): ShieldedSendResult {
    const result = sendShielded(input, shieldedBurnAddress(), value);
    this.totalBurned += normalizeAmount(value);
    return result;
  }

  burnFresh(
    mintValue: bigint | number,
    mintNonce: string,
    burnValue: bigint | number,
  ): ShieldedSendResult {
    const coin = this.mintToContract(mintValue, mintNonce);
    const result = sendImmediateShielded(coin, shieldedBurnAddress(), burnValue);
    this.totalBurned += normalizeAmount(burnValue);
    return result;
  }

  mintAndSend(
    mintValue: bigint | number,
    mintNonce: string,
    recipient: Recipient,
    sendValue: bigint | number,
  ): ShieldedSendResult {
    const coin = this.mintToContract(mintValue, mintNonce);
    return sendImmediateShielded(coin, recipient, sendValue);
  }
}

function splitCoin(
  input: ShieldedCoinInfo,
  recipient: Recipient,
  value: bigint | number,
  operation: string,
): ShieldedSendResult {
  const amount = normalizeAmount(value);
  if (amount > input.value) {
    throw new Error(`${operation} amount exceeds coin value`);
  }

  const sent: ShieldedCoinInfo = {
    nonce: evolveNonce(1n, input.nonce),
    color: input.color,
    value: amount,
    recipient,
  };

  const changeValue = input.value - amount;
  const change =
    changeValue === 0n
      ? null
      : {
          nonce: evolveNonce(2n, input.nonce),
          color: input.color,
          value: changeValue,
          recipient: CONTRACT_SELF,
        };

  return { sent, change };
}

function assertQualified(
  input: ShieldedCoinInfo | QualifiedShieldedCoinInfo,
): asserts input is QualifiedShieldedCoinInfo {
  if (!("mtIndex" in input)) {
    throw new Error("sendShielded requires a committed coin with an mtIndex");
  }
}

function normalizeAmount(value: bigint | number): bigint {
  const amount = BigInt(value);
  if (amount <= 0n) {
    throw new Error("amount must be non-zero");
  }
  return amount;
}

function normalizeBytes32(value: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase();
  }
  return hashBytes32("bytes32", value);
}
