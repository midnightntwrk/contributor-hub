
# Privacy Comparison: Monero vs. Midnight

This document compares the privacy features of Monero and Midnight.

## Core Privacy Model

| Cryptocurrency | Consensus | TPS | Fees | Proof Size | Privacy Technique |
|----------------|-----------|-----|------|------------|-------------------|
| Monero         | PoW       | 1,700 | Low  | ~1KB       | Ring signatures, Confidential transactions, RingCT |
| Zcash          | PoS (NU5 Upgrade) | 2,000 | Medium | ~1KB | zk-SNARKs |
| Aleo           | PoS       | 5,000+ | Low  | ~1KB       | zk-SNARKs/Leo |
| Aztecc         | L2 Rollup | 10,000+ | Very Low | <1KB | zk-SNARKs/Noir |
| Midnight       | PoS       | 2,500 | Low  | ~1KB       | zk-SNARKs |

## Transaction Privacy

Monero uses ring signatures to obscure the sender's identity and confidential transactions to hide the amount transferred. RingCT extends this by hiding the transaction type.

Midnight uses zk-SNARKs to provide privacy, allowing transactions to be verified without revealing the sender, receiver, or amount.

