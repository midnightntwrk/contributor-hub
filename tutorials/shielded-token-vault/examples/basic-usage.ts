/**
 * basic-usage.ts
 * 
 * Demonstrates basic Shielded Token Vault operations:
 * - Depositing tokens into the vault
 * - Checking shielded balance
 * - Withdrawing tokens
 * - Performing a shielded transfer
 * 
 * Prerequisites:
 * - Contract deployed (see src/deploy.ts)
 * - Proof server running on localhost:6300
 * - seed.txt with wallet seed phrase
 */

import { WalletBuilder } from "@midnight-ntwrk/wallet-sdk";
import { ShieldedVaultClient } from "../src/vault-client";
import * as fs from "fs";

async function main() {
  console.log("=== Shielded Token Vault — Basic Usage ===\n");

  // Initialize wallet from seed phrase
  const seed = fs.readFileSync("./seed.txt", "utf-8").trim();
  const wallet = await WalletBuilder.build(
    seed,
    "https://testnet.midnight.network/api",
    "testnet"
  );
  await wallet.start();

  // Read deployment info
  const deployment = JSON.parse(
    fs.readFileSync("./deployment.json", "utf-8")
  );

  // Create vault client
  const vault = new ShieldedVaultClient(wallet, {
    contractAddress: deployment.contractAddress,
    networkId: "testnet",
    proofServerUrl: "http://localhost:6300",
  });

  // Step 1: Deposit tokens into the vault
  console.log("--- Step 1: Deposit 1000 tokens ---");
  await vault.deposit(1000n);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}\n`);

  // Step 2: Make another deposit
  console.log("--- Step 2: Deposit 500 more tokens ---");
  await vault.deposit(500n);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}\n`);

  // Step 3: Withdraw some tokens
  console.log("--- Step 3: Withdraw 200 tokens ---");
  const myAddress = await wallet.getAddress();
  await vault.withdraw(200n, myAddress);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}\n`);

  // Step 4: Shielded transfer to another user
  console.log("--- Step 4: Shielded transfer of 300 tokens ---");
  const recipientPublicKey =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  await vault.shieldedTransfer(300n, recipientPublicKey);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}\n`);

  console.log("=== All operations completed successfully! ===");
}

main().catch(console.error);
