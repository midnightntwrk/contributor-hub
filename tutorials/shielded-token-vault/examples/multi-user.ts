/**
 * multi-user.ts
 * 
 * Demonstrates a multi-user scenario with the Shielded Token Vault:
 * - Two users (Alice and Bob) interact with the same vault
 * - Alice deposits and transfers to Bob (shielded)
 * - Bob withdraws tokens
 * - All amounts are hidden from external observers
 * 
 * This scenario shows how the vault preserves privacy even
 * when multiple parties interact with the same contract.
 */

import { WalletBuilder } from "@midnight-ntwrk/wallet-sdk";
import { ShieldedVaultClient } from "../src/vault-client";
import * as fs from "fs";

async function main() {
  console.log("=== Multi-User Shielded Vault Scenario ===\n");

  // Initialize wallets for Alice and Bob
  const aliceSeed = fs.readFileSync("./seeds/alice.txt", "utf-8").trim();
  const bobSeed = fs.readFileSync("./seeds/bob.txt", "utf-8").trim();

  const aliceWallet = await WalletBuilder.build(
    aliceSeed,
    "https://testnet.midnight.network/api",
    "testnet"
  );
  const bobWallet = await WalletBuilder.build(
    bobSeed,
    "https://testnet.midnight.network/api",
    "testnet"
  );

  await Promise.all([aliceWallet.start(), bobWallet.start()]);

  // Load contract deployment
  const deployment = JSON.parse(
    fs.readFileSync("./deployment.json", "utf-8")
  );
  const config = {
    contractAddress: deployment.contractAddress,
    networkId: "testnet",
    proofServerUrl: "http://localhost:6300",
  };

  const alice = new ShieldedVaultClient(aliceWallet, config);
  const bob = new ShieldedVaultClient(bobWallet, config);

  // Alice deposits tokens into the vault
  console.log("1. Alice deposits 5000 tokens into the vault...");
  await alice.deposit(5000n);
  console.log(`   Alice's shielded balance: ${alice.getShieldedBalance()}\n`);

  // Alice transfers 2000 to Bob (shielded — nobody else can see the amount)
  console.log("2. Alice transfers 2000 tokens to Bob (shielded)...");
  const bobPublicKey = await bobWallet.getSpendingKey();
  await alice.shieldedTransfer(2000n, bobPublicKey);
  console.log(`   Alice's shielded balance: ${alice.getShieldedBalance()}`);
  console.log(`   Bob's shielded balance: ${bob.getShieldedBalance()}\n`);

  // Bob withdraws 500 tokens
  console.log("3. Bob withdraws 500 tokens...");
  const bobAddress = await bobWallet.getAddress();
  await bob.withdraw(500n, bobAddress);
  console.log(`   Bob's shielded balance: ${bob.getShieldedBalance()}\n`);

  // Alice transfers more to Bob
  console.log("4. Alice transfers 1000 more tokens to Bob...");
  await alice.shieldedTransfer(1000n, bobPublicKey);
  console.log(`   Alice's shielded balance: ${alice.getShieldedBalance()}`);
  console.log(`   Bob's shielded balance: ${bob.getShieldedBalance()}\n`);

  // Final summary
  console.log("=== Final State ===");
  console.log(`Alice's shielded balance: ${alice.getShieldedBalance()}`);
  console.log(`Bob's shielded balance: ${bob.getShieldedBalance()}`);
  console.log(
    `\nTotal in vault: ${
      alice.getShieldedBalance() + bob.getShieldedBalance()
    }`
  );
  console.log(
    "(Note: Bob's withdrawn 500 tokens are no longer in the vault)\n"
  );
  console.log("=== Multi-user scenario complete! ===");
}

main().catch(console.error);
