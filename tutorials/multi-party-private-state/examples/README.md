# Multi-Party Private State — Code Examples

This directory contains example smart contracts demonstrating the patterns
described in the [Multi-Party Private State Tutorial](../multi-party-private-state.md).

## Examples

### 1. Bilateral Private Escrow (`bilateral-escrow.compact`)

**Pattern:** Bilateral Private Agreement

A two-party escrow where:
- Buyer privately sets a maximum price
- Seller privately sets a minimum price  
- The contract verifies the agreed price satisfies both constraints
- Neither party's bounds are ever revealed

### 2. Private Voting DAO (`private-voting.compact`)

**Pattern:** Threshold-Private State

A DAO voting mechanism where:
- Each member has private voting power
- Votes are cast as encrypted commitments
- A threshold of members must contribute decryption shares
- Final tally is revealed only after threshold is met

## Running the Examples

These examples use conceptual Compact syntax to illustrate patterns.
For actual compilation and deployment, see the
[Midnight developer documentation](https://docs.midnight.network/).

```bash
# Install the Compact compiler (when available)
npm install -g @midnight-ntwrk/compact

# Compile an example
compact compile bilateral-escrow.compact
```

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
