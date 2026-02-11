<!--
SPDX-License-Identifier: Apache-2.0
-->

# Solidity-to-Compact Comparison Guide

This guide maps common Solidity patterns to Compact patterns so Solidity developers can onboard quickly to Midnight.

References:
- Solidity baseline patterns from common EVM practice.
- Compact syntax/style from Midnight docs (`pragma language_version 0.16`, `ledger`, `circuit`, `witness`).

## 1) Contract Skeleton and Entry Points

```solidity
pragma solidity ^0.8.20;

contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}
```

```compact
pragma language_version 0.16;
import CompactStandardLibrary;

export ledger count: Uint<64>;

constructor() {
  count = disclose(0);
}

export circuit increment(): [] {
  count = count + 1;
}
```

## 2) State Variables and Privacy Boundary

```solidity
uint256 public total;
address private owner;
```

```compact
export ledger total: Uint<64>;
export ledger ownerKey: Bytes<32>;
```

Compact note: values in `ledger` are on-chain state; secrets are usually supplied via `witness` and proven in circuits instead of stored directly.

## 3) Constructor / Initialization

```solidity
constructor(address _owner, uint256 _initial) {
    owner = _owner;
    total = _initial;
}
```

```compact
constructor(sk: Bytes<32>, initial: Uint<64>) {
  ownerKey = disclose(persistentHash(sk));
  total = disclose(initial);
}
```

## 4) Access Control (Owner / Modifier Style)

```solidity
modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
}

function setTotal(uint256 next) external onlyOwner {
    total = next;
}
```

```compact
witness secretKey(): Bytes<32>;

export circuit setTotal(next: Uint<64>): [] {
  const sk = secretKey();
  const pk = persistentHash(sk);
  assert(ownerKey == pk, "not owner");
  total = disclose(next);
}
```

Compact note: authorization is usually proved via witness-derived values and `assert`, not EOA `msg.sender` checks.

## 5) Loops and Bounded Computation

```solidity
function sum(uint256[] calldata xs) external pure returns (uint256 s) {
    for (uint256 i = 0; i < xs.length; i++) s += xs[i];
}
```

```compact
circuit sum3(xs: Vector<3, Uint<64>>): Uint<64> {
  let s: Uint<64> = 0;
  for (let i = 0; i < 3; i = i + 1) {
    s = s + xs[i];
  }
  return s;
}
```

Compact note: prefer fixed-size/bounded data paths compatible with proof constraints.

## 6) Mappings / Key-Value Storage

```solidity
mapping(address => uint256) public balances;

function credit(address user, uint256 amount) external {
    balances[user] += amount;
}
```

```compact
// Pattern: commit key/value data and store compact state commitments.
export ledger balanceRoot: Bytes<32>;

export circuit updateBalanceRoot(nextRoot: Bytes<32>): [] {
  balanceRoot = disclose(nextRoot);
}
```

Compact note: many designs use commitments/Merkle roots for scalable or privacy-preserving key-value state.

## 7) Events and Audit Signals

```solidity
event Transfer(address indexed from, address indexed to, uint256 amount);
```

```compact
// Pattern: expose auditable state transitions through exported ledger/circuit outputs.
export ledger lastTransferCommitment: Bytes<32>;

export circuit recordTransfer(from: Bytes<32>, to: Bytes<32>, amount: Uint<64>, r: Bytes<32>): [] {
  lastTransferCommitment =
    persistentCommit<Vector<3, Bytes<32>>>([from, to, amount as Bytes<32>], r);
}
```

Compact note: event-like observability is often modeled via explicit state commitments and selective disclosure.

## 8) Require / Assert Validation

```solidity
require(amount > 0, "amount=0");
require(balance >= amount, "insufficient");
```

```compact
assert(amount > 0, "amount=0");
assert(balance >= amount, "insufficient");
```

## 9) Function Visibility and Interface Surface

```solidity
function quote() public view returns (uint256) { return total; }
function _internalMath(uint256 x) internal pure returns (uint256) { return x + 1; }
```

```compact
export circuit quote(): Uint<64> {
  return total;
}

circuit internalMath(x: Uint<64>): Uint<64> {
  return x + 1;
}
```

Pattern: `export circuit` is callable entrypoint; non-exported circuits are internal helpers.

## 10) Data Types and Structured Data

```solidity
struct Listing {
    address seller;
    uint256 price;
    bool active;
}
```

```compact
struct Listing {
  seller: Bytes<32>,
  price: Uint<64>,
  active: Boolean
}
```

## Key Conceptual Differences (Solidity vs Compact)

1. Identity and authorization:
   Solidity relies on transaction sender identity; Compact commonly proves authorization with witness-derived secrets and assertions.
2. Privacy defaults:
   Solidity state is transparent; Compact is designed for selective disclosure and private computation with proofs.
3. Storage patterns:
   Solidity uses direct mappings/arrays heavily; Compact often uses commitments or roots for privacy and bounded verification.
4. Computation model:
   Solidity executes imperative runtime EVM code; Compact compiles to circuits with bounded constraints.
5. Integration model:
   Solidity contracts are self-contained on-chain logic; Compact dApps split responsibilities between on-chain circuits and off-chain witness providers.

## When to Use Which Pattern

- Use direct ledger fields for public, low-volume state.
- Use commitments/Merkle roots when state should stay private or large.
- Keep circuit interfaces small and deterministic.
- Push secrets to witness functions; never expose raw secrets in ledger.

## Privacy-First Checklist for Solidity Developers

- Replace `msg.sender` assumptions with proof-based auth.
- Avoid leaking sensitive values in public ledger fields.
- Model logs as commitments + selective disclosure paths.
- Design with bounded circuit complexity from day one.

