// This file is part of contributor-hub.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0.

export type TokenKind = 'shielded' | 'unshielded' | 'dust';

export type BalanceOptions = {
  ttl: Date;
  tokenKindsToBalance: readonly TokenKind[];
};

export type SponsorshipRequest = {
  idempotencyKey: string;
  networkId: string;
  finalizedTransaction: unknown;
};

export type SponsorshipResult = {
  requestId: string;
  transactionId: string;
};

export type SponsorSecrets = {
  shieldedSecretKeys: unknown;
  dustSecretKey: unknown;
};

export type SponsorPolicy = {
  networkId: string;
  ttlMilliseconds: number;
  allow(request: SponsorshipRequest): Promise<boolean>;
};

export type SponsorWallet = {
  waitForSyncedState(): Promise<{ dust: { totalCoins: bigint } }>;
  balanceFinalizedTransaction(
    finalizedTransaction: unknown,
    secretKeys: SponsorSecrets,
    options: BalanceOptions,
  ): Promise<unknown>;
  signRecipe(recipe: unknown, sign: (payload: Uint8Array) => Promise<Uint8Array>): Promise<unknown>;
  finalizeRecipe(recipe: unknown): Promise<unknown>;
  submitTransaction(transaction: unknown): Promise<string>;
};

export class SponsorshipError extends Error {
  constructor(
    readonly code:
      | 'SPONSOR_DUST_UNAVAILABLE'
      | 'UNSUPPORTED_NETWORK'
      | 'POLICY_REJECTED'
      | 'INVALID_REQUEST',
    message: string,
  ) {
    super(message);
    this.name = 'SponsorshipError';
  }
}

export class DustSponsorService {
  constructor(
    private readonly wallet: SponsorWallet,
    private readonly secrets: SponsorSecrets,
    private readonly signSponsorPayload: (payload: Uint8Array) => Promise<Uint8Array>,
    private readonly policy: SponsorPolicy,
  ) {}

  async sponsor(request: SponsorshipRequest): Promise<SponsorshipResult> {
    this.validateRequest(request);

    if (request.networkId !== this.policy.networkId) {
      throw new SponsorshipError(
        'UNSUPPORTED_NETWORK',
        `Expected ${this.policy.networkId}, received ${request.networkId}.`,
      );
    }

    if (!(await this.policy.allow(request))) {
      throw new SponsorshipError('POLICY_REJECTED', 'The sponsor policy rejected this transaction.');
    }

    const synced = await this.wallet.waitForSyncedState();
    if (synced.dust.totalCoins <= 0n) {
      throw new SponsorshipError('SPONSOR_DUST_UNAVAILABLE', 'The sponsor wallet has no usable DUST.');
    }

    const recipe = await this.wallet.balanceFinalizedTransaction(
      request.finalizedTransaction,
      this.secrets,
      {
        ttl: new Date(Date.now() + this.policy.ttlMilliseconds),
        tokenKindsToBalance: ['dust'],
      },
    );
    const signedRecipe = await this.wallet.signRecipe(recipe, this.signSponsorPayload);
    const transaction = await this.wallet.finalizeRecipe(signedRecipe);
    const transactionId = await this.wallet.submitTransaction(transaction);

    return {
      requestId: request.idempotencyKey,
      transactionId,
    };
  }

  private validateRequest(request: SponsorshipRequest): void {
    if (request.idempotencyKey.trim().length === 0) {
      throw new SponsorshipError('INVALID_REQUEST', 'Missing idempotency key.');
    }

    if (request.networkId.trim().length === 0) {
      throw new SponsorshipError('INVALID_REQUEST', 'Missing network id.');
    }

    if (request.finalizedTransaction == null) {
      throw new SponsorshipError('INVALID_REQUEST', 'Missing finalized transaction.');
    }
  }
}
