---
title: "Getting NIGHT Tokens: Exchanges, Bridging & Wallet Funding on Midnight Mainnet"
description: "A complete walkthrough of every path for acquiring NIGHT tokens — exchanges, withdrawals, wallet setup, and the Cardano-to-Midnight bridge."
tags: [midnight, night, tutorial, web3, blockchain]
published: false
---

# Getting NIGHT Tokens: Exchanges, Bridging & Wallet Funding on Midnight Mainnet

## Introduction

NIGHT is the native and governance token of the Midnight Network. It's used for transaction fees, staking, and network governance. Holding NIGHT also generates DUST, a special-purpose token needed for certain network operations.

This tutorial covers every currently available path for acquiring NIGHT tokens, from centralized exchange purchases to DeFi bridging, with step-by-step instructions for each.

## Prerequisites

- A web browser and an internet connection
- Basic familiarity with cryptocurrency wallets
- Government-issued ID if completing KYC on a centralized exchange

## Method 1: Centralized Exchanges

### Supported Exchanges

As of June 2026, NIGHT is listed on the following major exchanges:

| Exchange | Trading Pairs | KYC Required | Withdrawal Fee |
|----------|--------------|--------------|----------------|
| **OKX** | NIGHT/USDT, NIGHT/USDC | Yes | ~0.1 NIGHT |
| **Kraken** | NIGHT/USD, NIGHT/EUR | Yes | ~0.5 NIGHT |
| **Gate.io** | NIGHT/USDT | Yes | ~0.2 NIGHT |
| **KuCoin** | NIGHT/USDT | Yes | ~0.1 NIGHT |
| **MEXC** | NIGHT/USDT | No (limited) | ~0.5 NIGHT |
| **Blockchain.com Wallet** | In-app swap | Yes | Variable |

### Step-by-Step: Buying on OKX

1. **Create and verify an account** at [okx.com](https://okx.com). Complete KYC verification (Tier 1 or higher).
2. **Deposit funds** — USDT or fiat currency via bank transfer, card, or P2P.
3. **Navigate to the NIGHT/USDT spot market** — search "NIGHT" in the Markets tab.
4. **Place a market or limit order** — enter the amount and confirm.
5. **Withdraw to your wallet** — go to Assets > Withdraw, paste your Midnight wallet address, and confirm.

### Step-by-Step: Buying on Kraken

1. **Create and verify** at [kraken.com](https://kraken.com). Complete Intermediate or Pro verification.
2. **Deposit fiat** (USD, EUR, GBP) via wire transfer or card.
3. **Trade NIGHT** — search for NIGHT in the Buy/Sell interface or use Kraken Pro for limit orders.
4. **Withdraw** — navigate to Funding > Withdraw, select NIGHT, and enter your wallet address.

## Method 2: Midnight Wallet Setup

Before buying NIGHT, you need a Midnight-compatible wallet to receive and hold tokens.

### Option A: Lace Wallet (Recommended)

Lace is the official Midnight wallet by Input Output Global.

1. **Install Lace** — download from [lace.io](https://lace.io) as a browser extension (Chrome/Firefox).
2. **Create a new wallet** or import an existing seed phrase.
3. **Add the Midnight network** — Lace automatically detects Midnight mainnet support.
4. **Find your NIGHT address** — click "Receive" and copy the Midnight address (starts with `0x`).
5. **Backup your seed phrase** — store it offline, never share it.

### Option B: 1AM Wallet

1AM is a mobile-first wallet with Midnight support.

1. Download from the App Store or Google Play.
2. Create a wallet and backup the recovery phrase.
3. Navigate to Settings > Networks and enable Midnight.
4. Your Midnight address is available under the Receive tab.

## Method 3: Withdrawing from Exchange to Wallet

1. **Copy your Midnight wallet address** from Lace or 1AM.
2. **On the exchange**, go to the withdrawal page for NIGHT.
3. **Paste your address** and enter the amount.
4. **Select the Midnight network** (not Cardano, not Ethereum — Midnight has its own network).
5. **Confirm** — double-check the address. Transactions are irreversible.
6. **Wait for confirmation** — exchange withdrawals typically process within 5-30 minutes.

## Method 4: Cardano-to-Midnight Bridging

The official bridge between Cardano and Midnight is operated by the Midnight Foundation. As of June 2026, the bridge supports:

- **Cardano (ADA) → Midnight (NIGHT):** Swap ADA for NIGHT via the Bridge portal.
- **Cardano native tokens → Midnight assets:** Selected Cardano native tokens can be bridged.

### Using the Bridge

1. Visit the official Midnight Bridge at [bridge.midnight.network](https://bridge.midnight.network).
2. Connect your Cardano wallet (Eternl, NAMI, Yoroi, or Typhon).
3. Connect your Midnight wallet (Lace).
4. Select the amount of ADA or Cardano tokens to bridge.
5. Review the estimated NIGHT output and bridge fee.
6. Confirm the transaction in your Cardano wallet.
7. Wait for the bridge to process (typically 5-20 minutes depending on Cardano block times).
8. Verify the NIGHT arrives in your Midnight wallet.

### Limitations

- Minimum bridge amount: ~100 ADA equivalent
- Maximum bridge amount: varies based on liquidity pool depth
- Bridge fees: approximately 0.5-1% of the bridged amount
- The Cardano-to-Midnight direction is operational; Midnight-to-Cardano may be more restricted

## Method 5: Glacier Drop Claim (Airdrop)

If you participated in the Midnight Glacier Drop program:

1. Visit [midnight.gd](https://midnight.gd).
2. Connect the wallet you used during the claim period.
3. Verify your eligibility.
4. Follow the on-screen instructions to claim your NIGHT allocation.
5. You may need to pay a small transaction fee in ADA or DUST to process the claim.

## Managing DUST

DUST is generated automatically when you hold NIGHT. It's needed for:

- Transaction fee subsidization
- Proof server operation fees
- Certain contract interactions

**To check your DUST balance:** Look at the DUST section in Lace Wallet under the Midnight network.

**To generate DUST:** Simply hold NIGHT in your wallet. DUST accrues proportionally over time (exact rate depends on the current DUST emission schedule).

## Troubleshooting

### "Invalid address" error when withdrawing from exchange

- Ensure you selected the **Midnight network** (not Cardano or Ethereum).
- Verify your address starts with `0x`.
- Check that your exchange supports NIGHT withdrawals to the Midnight network (not just Cardano wrapping).

### Tokens not showing in wallet

- Confirm the transaction is complete on the exchange side.
- Check your wallet is connected to the **Midnight mainnet** (not testnet).
- You may need to add the NIGHT token contract address manually in some wallets.

### Bridge transaction stuck

- Cardano transactions require 3-5 confirmations (~15-25 minutes).
- The bridge operator processes batches periodically.
- If stuck for more than 1 hour, check the bridge status page or contact Midnight Discord support.

## What's Coming (Roadmap)

- **Additional exchange listings** — several tier-2 exchanges are in the pipeline
- **Direct fiat on-ramps** — integration with MoonPay and Banxa is under development
- **DeFi liquidity pools** — NIGHT/USDC and NIGHT/ADA pools on DEXes
- **Simplified wallet funding** — direct credit/debit card purchase within Lace Wallet

## Conclusion

The most straightforward path to getting NIGHT tokens is:
1. Set up Lace Wallet
2. Buy on OKX or Kraken
3. Withdraw directly to your Midnight address

For Cardano-native users, the bridge offers an alternative that avoids exchange KYC. The Glacier Drop portal serves past participants.

Always double-check addresses, use the correct network when withdrawing, and never share your seed phrase or private keys.

**Have questions?** Join the Midnight Discord or Telegram community — links are available at [midnight.network](https://midnight.network).
