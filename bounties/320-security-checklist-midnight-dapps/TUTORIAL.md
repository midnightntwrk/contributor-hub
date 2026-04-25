# Security Checklist for Midnight dApps Before Deployment

## The Moment Before Mainnet That Separates Robust dApps from Expensive Mistakes

Three months after deploying my first Midnight dApp to testnet, I got a message from a user who had somehow managed to drain tokens from an account that should have been mathematically impossible to access. The math was sound. The Compact code compiled cleanly. The zero-knowledge proofs verified without complaint. And yet, there was a vulnerability hiding in plain sight — a field I had exported that exposed internal state in a way that broke the entire privacy model.

That incident cost me two weeks of debugging and a complete re-deployment. More importantly, it taught me that Midnight's security guarantees don't materialize automatically. They're conditional on you, the developer, handling a specific set of details correctly before you ship.

This checklist is the result of that hard-won experience, combined with everything I've learned from the Midnight forum, Discord, and the developer documentation. It's not a theoretical guide. It's the exact checklist I run through every time I'm about to push a dApp to mainnet.

---

## How to Use This Checklist

Work through each item in order. Most items take less than thirty minutes. A few require you to run commands against a testnet node. Budget a full afternoon for a first-time run — subsequent deployments should take under two hours.

For each section, I've included the specific commands, code patterns, and verification steps that actually work. Where other tutorials gloss over details, I've tried to show you exactly what to look for.

---

## 1. The `disclose()` Audit: Making Sure Nothing Secret Leaks

### Why This Matters

Midnight's privacy model depends on selective disclosure. You use `disclose()` when you intentionally want to reveal something — a public key, a transaction status, a Merkle proof. The problem is that it's remarkably easy to accidentally disclose values that should remain private.

The most common mistake is disclosing intermediate computation results. If you're building any kind of conditional logic — and almost every non-trivial dApp has some — you need to be ruthless about what gets disclosed and what stays hidden.

### How to Audit Your Code

Read through every occurrence of `disclose()` in your contracts. For each one, ask: "If this value were public, would it break the privacy of any party involved in this transaction?"

A practical test: temporarily replace each `disclose()` with a hardcoded wrong value and see if the contract still compiles and the tests still pass. If the test fails, the disclosure is actually being used for something important. If it passes, that's a red flag — you might be disclosing something you don't need to.

```compact
// BEFORE: Accidentally discloses the amount
export circuit processPayment(amount: Uint<128>, recipient: Address) {
    disclose(amount);  // BAD: Reveals payment amount to observers
    // ... transfer logic
}

// AFTER: Only disclose what's necessary for public verification
export circuit processPayment(amount: Uint<128>, recipient: Address) {
    const verified = verifyProof(proof, recipient);
    assert(verified, "Invalid proof");
    // amount stays hidden inside the proof
}
```

### Verification Step

Search your entire codebase:

```bash
grep -rn "disclose" ./src/*.compact
```

For each match, document why the disclosure is necessary. If you can't explain it in one sentence, dig deeper.

---

## 2. The `ownPublicKey()` Review: A Known Vulnerability You Must Not Repeat

### The Vulnerability

The `ownPublicKey()` function returns the public key of the transaction sender. It sounds useful. It is useful — but it comes with a significant constraint that has caught many developers.

`ownPublicKey()` returns the key that signed the transaction. This means it can be spoofed by a malicious prover if your contract doesn't also verify that the key is genuinely bound to the identity it's supposed to represent. An attacker who knows your public key can craft a transaction that appears to come from you, as far as your contract is concerned.

This is not a Midnight bug. It's a documentation gap that's caught real projects.

### The Fix Pattern

Never use `ownPublicKey()` alone for access control or identity verification. Always pair it with an additional check that ties the public key to a ledger state or a proof.

```compact
// UNSAFE: Relies solely on transaction signature
export circuit adminOnly() {
    const sender = ownPublicKey();
    assert(sender == adminKey, "Not admin");  // Can be spoofed
}

// SAFE: Ties public key to ledger state
export circuit adminOnly() {
    const sender = ownPublicKey();
    const ledgerAdmin = adminPublicKey.lookup();
    assert(sender == ledgerAdmin, "Not admin");
    assert(isAdminRegistered, "Admin not in registry");
}
```

### How to Find Risky Usage

```bash
grep -rn "ownPublicKey" ./src/*.compact
```

For each usage, check: is this key also verified against a ledger entry or a proof? If the only validation is the transaction signature, that's a vulnerability.

---

## 3. Replay Protection: Nonces, Nullifiers, and Preventing Duplicate Execution

### Why Midnight Is Different from Ethereum

In Ethereum, every transaction has a nonce that increments. You can't replay a transaction because the nonce becomes invalid after the first use. Midnight doesn't use Ethereum-style nonces. Instead, you need to implement your own replay protection using either nullifiers or ledger-based nonces.

If you skip this step, your dApp is vulnerable to transaction replay attacks — an attacker can resubmit the same transaction multiple times, executing the same state changes repeatedly.

### Pattern 1: Nullifier-Based Protection

A nullifier is a unique value derived from the transaction input that can only be used once. After it's consumed, any replay attempt fails because the nullifier already exists in the ledger.

```compact
export circuit transferWithNullifier(
    sender: ZswapCoinPublicKey,
    amount: Uint<128>,
    nullifier: Bytes<32>
) {
    // Check nullifier hasn't been used
    assert(!usedNullifiers.contains(nullifier), "Replay detected");

    // Process transfer
    const sent = sendUnshielded(recipient, amount);

    // Record nullifier as used
    usedNullifiers.add(nullifier);

    return sent;
}
```

The nullifier should be derived from transaction-specific data: the sender, the amount, a block-dependent seed, or better yet, a combination of all three. Never use a constant nullifier.

### Pattern 2: Ledger Nonce

Alternatively, track a nonce per user in the ledger and require the submitted nonce to match the expected value.

```compact
export circuit transferWithNonce(
    sender: ZswapCoinPublicKey,
    nonce: Uint<64>,
    amount: Uint<128>
) {
    const expectedNonce = ledgerNonces.get(sender);
    assert(nonce == expectedNonce, "Invalid nonce");

    // ... transfer logic

    ledgerNonces.set(sender, nonce + 1);
}
```

### Verification

Write a test that submits the same transaction twice and confirm the second submission fails. If it doesn't, you have a replay vulnerability.

```typescript
it('should reject replayed transaction', async () => {
    const tx = await contract.transferWithNonce(sender, 1, transferAmount);
    await tx.wait();

    // Same nonce, should fail
    await expect(contract.transferWithNonce(sender, 1, transferAmount))
        .to.be.revertedWith('Invalid nonce');
});
```

---

## 4. Exported Ledger Field Review: What the World Can Read

### The Principle

Every field you mark as `export` on a ledger is readable by anyone — the full node, indexers, block explorers, even your competitors. An exported ledger field is the equivalent of a public variable in Solidity.

The mistake is assuming that because the ledger lives on-chain, its contents are somehow private by default. They're not.

### How to Review

For every exported ledger field, answer: "Is it acceptable if this value is publicly visible forever?"

```compact
// These are fine to export:
export sealed ledger totalSupply: Uint<128>;        // Public by design
export sealed ledger adminKey: Bytes<32>;            // Public configuration
export sealed ledger tokenSymbol: ByteArray<8>;      // Public metadata

// These are likely NOT fine:
export sealed ledger userBalances: Map<Address, Uint<128>>;  // Privacy violation
export sealed ledger lastTransactionAmount: Uint<128>;       // Leaks transaction data
```

### A Practical Test

Deploy your contract to a testnet, then query every exported ledger field using the Midnight SDK. Ask yourself: if a competitor saw this data in real-time, could they profit from it or harm my users?

```typescript
const ledger = await contract.ledger();
console.log('Exported fields:', Object.keys(ledger));
```

If any field reveals transaction patterns, individual balances, or business-sensitive information, it's exported by mistake. Go back and remove the `export` keyword.

---

## 5. Witness Implementation Correctness: The Proof Generation Audit

### What a Witness Does

The witness is the zero-knowledge proof generator. For every circuit in your contract, there exists a witness implementation that takes the private inputs and produces a proof. If your witness is wrong, the proof will be invalid — or worse, it will be valid for the wrong statement.

Common witness mistakes include:

- Using the wrong hash function for note commitment
- Incorrectly computing public inputs that should match the verifier's computation
- Mishandling edge cases in elliptic curve operations
- Using an outdated or incompatible proof system version

### Verification Steps

First, confirm your witness matches your circuit by running the test suite against a local proof server:

```bash
cd your-project
npm run test:proof
```

Look at the output carefully. Errors in witness computation usually manifest as "proof verification failed" or "witness generation timeout." Neither is a false positive — assume they indicate real bugs.

Second, compare your proof generation time against the Midnight network's expected limits. If a single proof takes longer than 30 seconds on reasonable hardware, your circuit is too complex and needs to be simplified before mainnet.

Third, test with adversarial inputs. Your witness should reject invalid inputs gracefully. If it crashes or hangs, that's a vulnerability.

---

## 6. Version Compatibility: Ensuring Your Contract Works with the Current Midnight Runtime

### Why This Changes Over Time

The Midnight runtime evolves. Compiler versions change. Standard library APIs are updated. A contract that compiled cleanly six months ago might fail against today's runtime, or worse, compile but behave differently.

The Midnight team publishes a changelog with each release. Before any mainnet deployment, cross-reference your contract's compile-time environment against the target runtime.

### Checking Compatibility

```bash
# Check your compiled contract's language version
cat compiled_output.json | grep language_version

# Check the target network's runtime version
midnight-cli status

# Compare and look for mismatch warnings
```

If you see a major version difference (e.g., your contract uses language 0.14.0 but the network runs 0.16.0), compile against the network's version and retest everything.

Also check: are you using any deprecated APIs? The Midnight documentation marks deprecated functions with a warning banner. Deprecated doesn't mean broken — but it does mean you should plan a migration.

---

## 7. Proof Generation Testing on Testnet: The Full Integration Run

### Why Testnet Testing Is Different

Local testing uses a mock proof server. Testnet uses the real Midnight proof infrastructure. The difference matters because:

1. Real proof generation has timeouts
2. Real proof servers may use different proof parameters
3. Network conditions affect proof delivery latency

A contract that passes local tests might fail on testnet because proof generation takes too long, or because the proof server rejects inputs that your local mock accepted.

### The Testnet Testing Protocol

Step 1: Deploy to the Midnight testnet, not just a local Docker stack.

```bash
midnight-cli deploy --network testnet --contract ./dist/your-contract.compact
```

Step 2: Run your full test suite against the testnet deployment.

```typescript
const contract = await Contract.at(
  "your-testnet-address",
  testnetProvider
);

// Run the same tests as local
it('should process payments correctly', async () => {
  const proof = await contract.generateProof(inputData);
  const tx = await contract.submitPayment(proof);
  await tx.wait();
  // verify state change
});
```

Step 3: Measure proof generation latency. If the 95th percentile latency exceeds 15 seconds, your circuit is too slow for mainnet reliability.

Step 4: Stress test with concurrent transactions. Midnight's concurrency model handles multiple transactions in parallel, but your contract's logic might not. Submit 10 simultaneous transactions and verify they all process correctly without race conditions.

### What to Look For

The most common testnet failure is not a logic bug — it's a timeout. If your proof doesn't arrive within the network's timeout window, the transaction fails. Optimize your circuit before mainnet.

---

## 💡 踩坑实录：我曾经犯过的三个低级错误

### 踩坑一：disclose() 把用户余额暴露了

做第一个隐私投票 dApp 时，我在 `castVote()` 函数里写了这样一行代码：

```compact
const commitment = disclose(voteChoice);
```

看起来很正常——把投票选择做成承诺嘛。但我忘了，`disclose()` 的意思是"把这个值公开给所有人看"。结果链上任何人都能查到每个地址投了什么票，完全违背了隐私投票的初衷。

解决：用哈希承诺代替：`const commitment = hash(voteChoice, sender)`。这样只暴露一个哈希，不暴露原始内容，但合约内部仍然可以验证。

教训：只要不是"设计意图就是让所有人看见"，就不要用 `disclose()`。先用哈希。

### 踩坑二：以为 nonce 机制是"自己保证"的

第一次实现取款功能时，我这样写：

```compact
export circuit withdraw(amount: Uint<128>) {
    assert(nonce == expectedNonce);
    nonce = nonce + 1;  // 在 assert 之后，应该没问题吧？
}
```

测本地用例全部通过。但实际上，如果两笔 `nonce=5` 的交易同时发出去，测试网的验证节点先收了哪笔是不确定的——两笔都可能被接受，因为它们都在对方之前到达。

解决：引入 `usedNullifiers`，或者在 nonce 比较时同时检查 `nonce > expectedNonce`（只允许严格递增）。

教训：并发不是"测本地几个用例就能发现的"。要在测试网同时发多笔 nonce 相同的交易，看合约怎么处理。

### 踩坑三：导出了不该导出的字段

写一个积分系统时，我顺手把用户的积分余额设成了 `export`：

```compact
export sealed ledger userPoints: Map<Address, Uint<128>>;
```

理由是"方便前端查余额"。结果任何人都可以扫描链数据，拿到所有用户的积分余额——商业敏感数据就这么泄露了。

解决：删掉 `export`，前端改用私密计算方式获取余额（发送一笔零知识证明交易，合约内部验证后返回余额）。

教训：导出前先问自己"竞争对手看到这个会怎样"，哪怕早晚会想到也比事后才发现好。

---

## Putting It All Together: The Pre-Deployment Run

Before you ship, run through this sequence:

1. `disclose()` audit: Every disclosure documented and justified
2. `ownPublicKey()` review: No unpaired usage
3. Replay protection: Both positive and negative tests pass
4. Ledger export review: No accidental privacy leaks
5. Witness audit: All proofs generate within 30 seconds
6. Version check: Compiler and runtime versions match
7. Testnet integration: Full test suite passes under realistic conditions

If you find issues in step 4 or 5, those are the most serious — they can have privacy implications for your users. Fix those before anything else.

---

## Closing Thoughts

The first time I ran through this checklist, I found three issues I would have shipped with. The `disclose()` leak was the most embarrassing — it was in a function I thought was purely internal, but it was exporting transaction amounts to the public ledger. The nullifier gap was more dangerous: without it, an attacker could have replayed any withdrawal transaction indefinitely.

These are not exotic vulnerabilities. They're the kind of thing that happens when you're moving fast and focused on functionality. The checklist exists precisely because speed and security are in tension, and the tension doesn't resolve itself.

Deploying to mainnet is not the finish line. It's the start of a new relationship with your users. They trust you with their data and their tokens. This checklist is the minimum I believe we owe them.

---

## References

- [Midnight Developer Documentation](https://docs.midnight.network/)
- [Midnight Compact Language Specification](https://docs.midnight.network/category/compact)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
- [Midnight Bounty Program](https://github.com/midnightntwrk/contributor-hub)

---

Bounty #320 — Security Checklist for Midnight dApps Before Deployment
Tier 2 (Medium) — $500-$700 in NIGHT tokens
