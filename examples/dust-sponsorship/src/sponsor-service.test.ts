// This file is part of contributor-hub.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DustSponsorService,
  SponsorshipError,
  type SponsorPolicy,
  type SponsorWallet,
} from './sponsor-service.js';

const policy: SponsorPolicy = {
  networkId: 'preprod',
  ttlMilliseconds: 30 * 60 * 1000,
  allow: async () => true,
};

function walletWithDust(balance: bigint): SponsorWallet & { tokenKinds: string[] } {
  const observed = { tokenKinds: [] as string[] };

  return {
    ...observed,
    waitForSyncedState: async () => ({
      dust: {
        totalCoins: balance,
      },
    }),
    balanceFinalizedTransaction: async (_tx, _secrets, options) => {
      observed.tokenKinds.push(...options.tokenKindsToBalance);
      return { recipe: true };
    },
    signRecipe: async (recipe) => ({ recipe, signed: true }),
    finalizeRecipe: async (recipe) => ({ recipe, finalized: true }),
    submitTransaction: async () => 'tx-123',
  };
}

test('sponsors finalized transactions by balancing only dust', async () => {
  const wallet = walletWithDust(1n);
  const service = new DustSponsorService(
    wallet,
    { shieldedSecretKeys: {}, dustSecretKey: {} },
    async (payload) => payload,
    policy,
  );

  const result = await service.sponsor({
    idempotencyKey: 'request-1',
    networkId: 'preprod',
    finalizedTransaction: { tx: true },
  });

  assert.deepEqual(result, { requestId: 'request-1', transactionId: 'tx-123' });
  assert.deepEqual(wallet.tokenKinds, ['dust']);
});

test('rejects when the sponsor has no visible dust capacity', async () => {
  const service = new DustSponsorService(
    walletWithDust(0n),
    { shieldedSecretKeys: {}, dustSecretKey: {} },
    async (payload) => payload,
    policy,
  );

  await assert.rejects(
    () =>
      service.sponsor({
        idempotencyKey: 'request-2',
        networkId: 'preprod',
        finalizedTransaction: { tx: true },
      }),
    (error) => error instanceof SponsorshipError && error.code === 'SPONSOR_DUST_UNAVAILABLE',
  );
});

test('rejects unsupported networks before balancing', async () => {
  const service = new DustSponsorService(
    walletWithDust(1n),
    { shieldedSecretKeys: {}, dustSecretKey: {} },
    async (payload) => payload,
    policy,
  );

  await assert.rejects(
    () =>
      service.sponsor({
        idempotencyKey: 'request-3',
        networkId: 'preview',
        finalizedTransaction: { tx: true },
      }),
    (error) => error instanceof SponsorshipError && error.code === 'UNSUPPORTED_NETWORK',
  );
});
