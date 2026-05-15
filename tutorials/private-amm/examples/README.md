# Private AMM on Midnight

A privacy-preserving Automated Market Maker (AMM) built on Midnight Network using Compact smart contracts.

## Features

- **Constant product formula** (x*y=k) with 0.3% swap fee
- **Shielded swaps** — trade amounts and trader identity are private
- **Private LP positions** — your liquidity share is hidden via Merkle tree storage
- **Transparent reserves** — pool health is publicly verifiable for price discovery
- **MEV protection** — encrypted mempool prevents front-running and sandwich attacks

## Architecture

```
User (shielded input) -> PrivateAMM Contract -> Shielded output
                            |
                    [Transparent reserves updated]
                            |
                    [Merkle tree LP balance updated]
```

### Privacy Model

| Component        | Visibility | Reason                           |
|-----------------|------------|----------------------------------|
| Pool reserves    | Public     | Price discovery and routing      |
| Total LP supply  | Public     | Reserve calculations             |
| Swap amounts     | Private    | Shielded via ZK proofs           |
| Trader identity  | Private    | Derived from secret key          |
| LP positions     | Private    | Stored in Merkle tree            |

## Files

- `amm.compact` — Compact smart contract with all AMM logic
- `amm-client.ts` — TypeScript client with shielding/unshielding
- `usage.ts` — Complete usage example (pool creation, swaps, LP management)

## Quick Start

```bash
# Install dependencies
npm install @midnight-ntwrk/compact-runtime @midnight-ntwrk/wallet-sdk

# Compile contract
npx compact compile amm.compact

# Run example
npx ts-node usage.ts
```

## How It Works

1. **Shielded tokens**: Input amounts are encrypted with the user's secret key before being sent to the contract
2. **Circuit execution**: The Compact circuit decrypts values internally via `reveal_to_circuit()`, computes the swap, and re-encrypts the output
3. **Transparent reserves**: Pool reserves are updated in cleartext for price discovery
4. **Private balances**: LP token balances are stored in a Merkle tree — users prove ownership without revealing their position

## License

Apache-2.0
