// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';

interface TokenActionsProps {
  onMint: (to: string, amount: bigint) => Promise<boolean>;
  onTransfer: (to: string, amount: bigint) => Promise<boolean>;
  onApprove: (spender: string, amount: bigint) => Promise<boolean>;
  isLoading: boolean;
  userAddress: string;
}

/**
 * TokenActions component
 * 
 * Provides forms for minting, transferring, and approving tokens.
 */
export function TokenActions({
  onMint,
  onTransfer,
  onApprove,
  isLoading,
  userAddress,
}: TokenActionsProps) {
  const [activeTab, setActiveTab] = useState<'mint' | 'transfer' | 'approve'>('transfer');

  return (
    <div className="actions-card">
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'transfer' ? 'active' : ''}`}
          onClick={() => setActiveTab('transfer')}
        >
          Transfer
        </button>
        <button
          className={`tab ${activeTab === 'mint' ? 'active' : ''}`}
          onClick={() => setActiveTab('mint')}
        >
          Mint
        </button>
        <button
          className={`tab ${activeTab === 'approve' ? 'active' : ''}`}
          onClick={() => setActiveTab('approve')}
        >
          Approve
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'mint' && (
          <MintForm onMint={onMint} isLoading={isLoading} />
        )}
        {activeTab === 'transfer' && (
          <TransferForm onTransfer={onTransfer} isLoading={isLoading} />
        )}
        {activeTab === 'approve' && (
          <ApproveForm onApprove={onApprove} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

interface MintFormProps {
  onMint: (to: string, amount: bigint) => Promise<boolean>;
  isLoading: boolean;
}

function MintForm({ onMint, isLoading }: MintFormProps) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (to && amount) {
      const success = await onMint(to, BigInt(amount));
      if (success) {
        setTo('');
        setAmount('');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="action-form">
      <h3>Mint Tokens</h3>
      <p className="form-description">Create new tokens and send them to an address.</p>
      <div className="form-group">
        <label htmlFor="mint-to">Recipient Address</label>
        <input
          id="mint-to"
          type="text"
          placeholder="0x..."
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="mint-amount">Amount</label>
        <input
          id="mint-amount"
          type="number"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="1"
          className="input"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading || !to || !amount}
        className="btn btn-primary"
      >
        {isLoading ? 'Minting...' : 'Mint Tokens'}
      </button>
    </form>
  );
}

interface TransferFormProps {
  onTransfer: (to: string, amount: bigint) => Promise<boolean>;
  isLoading: boolean;
}

function TransferForm({ onTransfer, isLoading }: TransferFormProps) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (to && amount) {
      const success = await onTransfer(to, BigInt(amount));
      if (success) {
        setTo('');
        setAmount('');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="action-form">
      <h3>Transfer Tokens</h3>
      <p className="form-description">Send tokens from your wallet to another address.</p>
      <div className="form-group">
        <label htmlFor="transfer-to">Recipient Address</label>
        <input
          id="transfer-to"
          type="text"
          placeholder="0x..."
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="transfer-amount">Amount</label>
        <input
          id="transfer-amount"
          type="number"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="1"
          className="input"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading || !to || !amount}
        className="btn btn-primary"
      >
        {isLoading ? 'Transferring...' : 'Transfer'}
      </button>
    </form>
  );
}

interface ApproveFormProps {
  onApprove: (spender: string, amount: bigint) => Promise<boolean>;
  isLoading: boolean;
}

function ApproveForm({ onApprove, isLoading }: ApproveFormProps) {
  const [spender, setSpender] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (spender && amount) {
      const success = await onApprove(spender, BigInt(amount));
      if (success) {
        setSpender('');
        setAmount('');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="action-form">
      <h3>Approve Spender</h3>
      <p className="form-description">Allow another address to spend tokens on your behalf.</p>
      <div className="form-group">
        <label htmlFor="approve-spender">Spender Address</label>
        <input
          id="approve-spender"
          type="text"
          placeholder="0x..."
          value={spender}
          onChange={(e) => setSpender(e.target.value)}
          className="input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="approve-amount">Allowance Amount</label>
        <input
          id="approve-amount"
          type="number"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          className="input"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading || !spender || !amount}
        className="btn btn-primary"
      >
        {isLoading ? 'Approving...' : 'Approve'}
      </button>
    </form>
  );
}

export default TokenActions;
