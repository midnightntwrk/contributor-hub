# Building a Private AMM on Midnight

Automated market makers power most of DeFi, but every swap on Ethereum is public. MEV bots watch the mempool, see your trade size and direction, and sandwich attack you before and after your transaction. The miner extractable value problem costs traders hundreds of millions per year.

Midnight changes this. You can build an AMM where pool reserves are public (so price discovery works) but individual swap amounts and trader identities are private. This tutorial walks through exactly how to do that using Compact smart contracts and shielded tokens.

## What You'll Build

A constant-product AMM (`x * y = k`) where:
- Pool reserves and the exchange rate are publicly visible
- Swap amounts and trader addresses are shielded
- Liquidity provider (LP) positions are privately held
- The invariant is enforced using zero-knowledge proofs

## Prerequisites

- Midnight SDK installed: `npm install -g @midnight-ntwrk/midnight-js-cli`
- Basic understanding of how AMMs work (constant-product formula)
- Familiarity with TypeScript

## The Privacy Problem with Ethereum AMMs

On Uniswap, every swap transaction includes your wallet address, the exact input/output amounts, and the token pair. Front-runners read pending transactions from the mempool and insert their own trades to profit from price impact. This is called sandwich attacking.

The attack looks like this:

1. Bot sees your pending swap of 10 ETH for USDC
2. Bot buys USDC before your transaction (price goes up)
3. Your transaction executes at the worse price
4. Bot sells USDC after your transaction (at the inflated price)

Midnight prevents this because swap details live in shielded state. The network proves the AMM invariant holds without revealing what trade happened.

## AMM Architecture on Midnight

A Midnight AMM has two layers:

**Public state** — pool reserves and total LP token supply. Anyone can see the current price.

**Private state** — individual swap amounts, trader identities, and LP positions. Only the involved parties can see these.

```compact
// AMM contract in Compact
contract AMM {
  // Public: visible to everyone
  ledger reserve_a: Uint<64>;
  ledger reserve_b: Uint<64>;
  ledger total_lp_supply: Uint<64>;

  // Pool identifier (public)
  ledger pool_id: Bytes<32>;
}
```

The shielded tokens for each trader's position are managed using Midnight's native token protocol, which handles the cryptographic commitments automatically.

## Implementing the Constant Product Formula

The core invariant is `x * y = k`. After a swap, the product of reserves must be at least as large as before:

```compact
// Verify the AMM invariant holds after a swap
circuit verify_swap_invariant(
  reserve_a_before: Uint<64>,
  reserve_b_before: Uint<64>,
  reserve_a_after: Uint<64>,
  reserve_b_after: Uint<64>
): [] {
  // k must be preserved (with fee, k can increase slightly)
  assert reserve_a_after * reserve_b_after >= reserve_a_before * reserve_b_before;
  // Reserves must be positive
  assert reserve_a_after > 0;
  assert reserve_b_after > 0;
}
```

Circuits in Compact run inside the zero-knowledge proof system. When a trader executes a swap, they locally compute the new reserve values and generate a proof that the invariant holds — without revealing the swap amounts.

## Private Swap Function

Here is the full swap circuit. The trader proves they are providing a valid input amount and that the output satisfies the constant-product constraint:

```compact
// Swap token_a for token_b, keeping amounts private
circuit swap_a_for_b(
  // Private inputs (only the prover knows these)
  amount_in: Uint<64>,
  min_amount_out: Uint<64>,
  trader_nonce: Bytes<32>
): Uint<64> {
  // Read current public reserves
  const ra = AMM.reserve_a;
  const rb = AMM.reserve_b;

  // Apply 0.3% fee: effective input is 99.7% of amount_in
  const amount_in_with_fee = amount_in * 997;

  // Constant product formula: amount_out = (rb * amount_in_with_fee) / (ra * 1000 + amount_in_with_fee)
  const amount_out = (rb * amount_in_with_fee) / (ra * 1000 + amount_in_with_fee);

  // Slippage protection
  assert amount_out >= min_amount_out;

  // Verify invariant holds
  const new_ra = ra + amount_in;
  const new_rb = rb - amount_out;
  verify_swap_invariant(ra, rb, new_ra, new_rb);

  // Update public reserves
  AMM.reserve_a = new_ra;
  AMM.reserve_b = new_rb;

  // Return the output amount (used to mint shielded tokens to the trader)
  return amount_out;
}
```

The `amount_in` and `amount_out` values never appear on the public ledger. Only the updated reserve values are written publicly. An observer sees that a swap happened and the new reserves, but not who traded or how much.

## Adding Liquidity Privately

LP positions are held as shielded tokens. A liquidity provider deposits token A and token B, and receives LP tokens that represent their share of the pool:

```compact
circuit add_liquidity(
  amount_a: Uint<64>,
  amount_b: Uint<64>
): Uint<64> {
  const ra = AMM.reserve_a;
  const rb = AMM.reserve_b;
  const total_lp = AMM.total_lp_supply;

  let lp_tokens_to_mint: Uint<64>;

  if total_lp == 0 {
    // Initial liquidity: geometric mean of deposits
    // Simplified: use amount_a as initial LP supply
    lp_tokens_to_mint = amount_a;
  } else {
    // Proportional to existing reserves
    const lp_from_a = (amount_a * total_lp) / ra;
    const lp_from_b = (amount_b * total_lp) / rb;
    // Use the minimum to enforce proportional deposit
    lp_tokens_to_mint = if lp_from_a < lp_from_b { lp_from_a } else { lp_from_b };
  }

  // Verify deposit ratio matches pool ratio (within tolerance)
  assert amount_a * rb >= amount_b * ra * 99 / 100;
  assert amount_b * ra >= amount_a * rb * 99 / 100;

  // Update public state
  AMM.reserve_a = ra + amount_a;
  AMM.reserve_b = rb + amount_b;
  AMM.total_lp_supply = total_lp + lp_tokens_to_mint;

  return lp_tokens_to_mint;
}
```

The LP tokens minted here are shielded — nobody knows which wallet holds how many LP tokens.

## Removing Liquidity

When removing liquidity, the LP proves they hold a certain number of LP tokens and receives back their proportional share of the pool:

```compact
circuit remove_liquidity(
  lp_amount: Uint<64>
): [Uint<64>, Uint<64>] {
  const ra = AMM.reserve_a;
  const rb = AMM.reserve_b;
  const total_lp = AMM.total_lp_supply;

  assert lp_amount <= total_lp;
  assert total_lp > 0;

  // Proportional share of reserves
  const amount_a_out = (lp_amount * ra) / total_lp;
  const amount_b_out = (lp_amount * rb) / total_lp;

  assert amount_a_out > 0;
  assert amount_b_out > 0;

  // Update public state
  AMM.reserve_a = ra - amount_a_out;
  AMM.reserve_b = rb - amount_b_out;
  AMM.total_lp_supply = total_lp - lp_amount;

  return [amount_a_out, amount_b_out];
}
```

## TypeScript Integration

On the client side, you build and submit transactions using the Midnight SDK:

```typescript
import { MidnightProvider } from '@midnight-ntwrk/midnight-js-network-id';
import { createMidnightClient } from '@midnight-ntwrk/midnight-js-client';

async function executeSwap(
  provider: MidnightProvider,
  amountIn: bigint,
  minAmountOut: bigint
): Promise<void> {
  const client = await createMidnightClient(provider);

  // Build the private transaction
  // The SDK handles witness generation and proof creation
  const tx = await client.buildTransaction({
    contract: AMM_CONTRACT_ADDRESS,
    circuit: 'swap_a_for_b',
    privateInputs: {
      amount_in: amountIn,
      min_amount_out: minAmountOut,
      trader_nonce: crypto.getRandomValues(new Uint8Array(32))
    }
  });

  // Submit — the swap amount stays private
  const receipt = await client.submitTransaction(tx);
  console.log('Swap completed:', receipt.txHash);
}
```

The private inputs never leave the client. The SDK generates a zk-SNARK proof locally and submits the proof + public state update to the network.

## Testing Locally

Set up a local Midnight node and run the test suite:

```bash
# Clone the example repo
git clone https://github.com/your-handle/midnight-private-amm

# Install dependencies
cd midnight-private-amm && npm install

# Start local node
npx midnight-js-cli node start --network testnet

# Deploy the AMM contract
npx ts-node scripts/deploy.ts

# Run end-to-end tests
npm test
```

The test suite covers:
- Pool initialization with zero liquidity
- Adding liquidity from multiple providers (positions stay private from each other)
- Swapping in both directions
- Verifying the constant product invariant after each swap
- Removing liquidity and verifying token receipt

## What This Enables

Private AMMs on Midnight eliminate MEV at the protocol level. Because swap amounts are never visible to validators or other observers, sandwich attacks cannot be constructed. The price impact of your trade is not known until after it settles.

This pattern extends naturally to:
- **Concentrated liquidity AMMs**: LP positions specify a price range, kept private
- **Multi-hop routes**: The path through multiple pools stays private
- **Limit orders over AMMs**: Orders sit in shielded state until the price condition is met

## Next Steps

- Review the [Midnight token standard](https://docs.openzeppelin.com/contracts-compact) for shielded token primitives
- Look at the [OpenZeppelin Midnight apps repository](https://github.com/OpenZeppelin/midnight-apps) for reference implementations
- Post your implementation in the [Midnight developer forum](https://forum.midnight.network/) — the community can help with circuit optimization

The full code for this tutorial is available at: [github.com/your-handle/midnight-private-amm](https://github.com/your-handle/midnight-private-amm)

---

*Published on dev.to: [link-to-article]*
