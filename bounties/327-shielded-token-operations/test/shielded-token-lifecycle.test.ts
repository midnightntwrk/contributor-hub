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

import { describe, expect, it } from "vitest";
import {
  BURN_ADDRESS,
  CONTRACT_SELF,
  ShieldedTokenHarness,
  commitCoin,
  evolveNonce,
  hashBytes32,
  publicKey,
  sendImmediateShielded,
  sendShielded,
  shieldedBurnAddress,
  tokenType,
  type QualifiedShieldedCoinInfo,
} from "../src/model/shielded-token-model.js";

const DOMAIN = hashBytes32("la-tanda:shielded-token");
const NONCE = hashBytes32("nonce:0");
const SEED = hashBytes32("private-nonce-seed");
const ALICE = publicKey("alice");
const BOB = publicKey("bob");

describe("shielded token lifecycle model", () => {
  it("mints a shielded coin to the contract with the expected color", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    const coin = harness.mintToContract(1000n, NONCE);

    expect(coin).toMatchObject({
      nonce: NONCE,
      color: tokenType(DOMAIN),
      value: 1000n,
      recipient: CONTRACT_SELF,
    });
    expect(harness.mintedOperations).toBe(1);
  });

  it("derives deterministic unique nonces with evolveNonce", () => {
    const first = evolveNonce(0n, SEED);
    const second = evolveNonce(1n, SEED);

    expect(first).not.toEqual(second);
    expect(evolveNonce(0n, SEED)).toEqual(first);
  });

  it("supports local nonce minting without reusing the seed directly", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    const first = harness.mintWithLocalNonce(10n, SEED, 0n);
    const second = harness.mintWithLocalNonce(10n, SEED, 1n);

    expect(first.nonce).toEqual(evolveNonce(0n, SEED));
    expect(second.nonce).toEqual(evolveNonce(1n, SEED));
    expect(first.nonce).not.toEqual(second.nonce);
  });

  it("requires a committed Merkle position before sendShielded can spend a coin", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const fresh = harness.mintToContract(25n, NONCE);

    expect(() =>
      sendShielded(fresh as unknown as QualifiedShieldedCoinInfo, ALICE, 5n),
    ).toThrow(/mtIndex/);
  });

  it("commits a fresh coin into a QualifiedShieldedCoinInfo with mtIndex", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const fresh = harness.mintToContract(25n, NONCE);

    const qualified = harness.commit(fresh);

    expect(qualified.mtIndex).toBe(0n);
    expect(qualified.value).toBe(25n);
  });

  it("transfers a partial amount and returns contract-owned change", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(100n, NONCE));

    const result = harness.sendCommitted(qualified, ALICE, 35n);

    expect(result.sent).toMatchObject({
      value: 35n,
      color: qualified.color,
      recipient: ALICE,
    });
    expect(result.change).toMatchObject({
      value: 65n,
      color: qualified.color,
      recipient: CONTRACT_SELF,
    });
    expect(result.sent.nonce).not.toEqual(result.change?.nonce);
  });

  it("transfers an exact amount without change", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(100n, NONCE));

    const result = harness.sendCommitted(qualified, ALICE, 100n);

    expect(result.sent.value).toBe(100n);
    expect(result.change).toBeNull();
  });

  it("rejects a committed transfer that exceeds the input value", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(100n, NONCE));

    expect(() => harness.sendCommitted(qualified, ALICE, 101n)).toThrow(
      /exceeds coin value/,
    );
  });

  it("rejects zero-value mint and send operations", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(1n, NONCE));

    expect(() => harness.mintToContract(0n, NONCE)).toThrow(/non-zero/);
    expect(() => harness.sendCommitted(qualified, ALICE, 0n)).toThrow(/non-zero/);
  });

  it("burns committed coins by sending to shieldedBurnAddress", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(90n, NONCE));

    const result = harness.burnCommitted(qualified, 40n);

    expect(result.sent).toMatchObject({
      value: 40n,
      recipient: BURN_ADDRESS,
    });
    expect(result.change?.value).toBe(50n);
    expect(harness.totalBurned).toBe(40n);
    expect(shieldedBurnAddress()).toEqual(BURN_ADDRESS);
  });

  it("burns a freshly minted coin with sendImmediateShielded", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    const result = harness.burnFresh(75n, NONCE, 75n);

    expect(result.sent).toMatchObject({
      value: 75n,
      recipient: BURN_ADDRESS,
    });
    expect(result.change).toBeNull();
    expect(harness.totalBurned).toBe(75n);
  });

  it("returns change when burning part of a freshly minted coin", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    const result = harness.burnFresh(75n, NONCE, 25n);

    expect(result.sent.value).toBe(25n);
    expect(result.change).toMatchObject({
      value: 50n,
      recipient: CONTRACT_SELF,
    });
  });

  it("rejects an over-burn from a fresh coin", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    expect(() => harness.burnFresh(75n, NONCE, 76n)).toThrow(/exceeds coin value/);
  });

  it("performs atomic mint_and_send without a Merkle index", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    const result = harness.mintAndSend(120n, NONCE, ALICE, 45n);

    expect(result.sent).toMatchObject({
      value: 45n,
      recipient: ALICE,
      color: tokenType(DOMAIN),
    });
    expect(result.change?.value).toBe(75n);
  });

  it("rejects atomic mint_and_send when sendValue exceeds mintValue", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);

    expect(() => harness.mintAndSend(120n, NONCE, ALICE, 121n)).toThrow(
      /exceeds coin value/,
    );
  });

  it("allows change from one transaction to be committed and spent later", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = harness.commit(harness.mintToContract(100n, NONCE));
    const first = harness.sendCommitted(qualified, ALICE, 30n);

    const change = harness.commit(first.change!);
    const second = harness.sendCommitted(change, BOB, 20n);

    expect(second.sent).toMatchObject({
      value: 20n,
      recipient: BOB,
    });
    expect(second.change?.value).toBe(50n);
  });

  it("supports direct immediate sends for coins produced in the same transaction", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const fresh = harness.mintToContract(60n, hashBytes32("nonce:immediate"));

    const result = sendImmediateShielded(fresh, ALICE, 10n);

    expect(result.sent.recipient).toEqual(ALICE);
    expect(result.change?.recipient).toEqual(CONTRACT_SELF);
  });

  it("preserves coin color across send, burn, and change outputs", () => {
    const harness = new ShieldedTokenHarness(DOMAIN);
    const qualified = commitCoin(harness.mintToContract(100n, NONCE), 8n);

    const send = harness.sendCommitted(qualified, ALICE, 25n);
    const burn = harness.burnCommitted(harness.commit(send.change!), 10n);

    expect(send.sent.color).toEqual(tokenType(DOMAIN));
    expect(send.change?.color).toEqual(tokenType(DOMAIN));
    expect(burn.sent.color).toEqual(tokenType(DOMAIN));
    expect(burn.change?.color).toEqual(tokenType(DOMAIN));
  });
});
