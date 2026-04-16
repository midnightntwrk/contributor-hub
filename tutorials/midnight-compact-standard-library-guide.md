# Tutorial: Compact Standard Library: A Practical Guide to Every Export

**Bounty Issue**: #293

## Introduction

The Compact standard library provides ~30 reusable exports for building Zero-Knowledge contracts. This tutorial walks through every major category with working examples, so you know what's available and how to use each export correctly.

## Categories Overview

| Category | Exports | Use Case |
|----------|---------|---------|
| Generic Types | `Maybe`, `Either` | Option/Result types |
| Merkle Trees | `MerkleTree`, `merkle_verify` | Membership proofs |
| Elliptic Curves | `Point`, `ec_add`, `ec_mul` | Cryptographic operations |
| Kernel Types | `ContractAddress`, `ZswapCoinPublicKey`, `UserAddress` | Address types |
| Helper Circuits | `nativeToken`, `tokenType`, `evolveNonce` | Token operations |
| Shielded Ops | `mint`, `burn`, `transfer` | Private token ops |
| Block/Time | `block_number`, `timestamp` | On-chain queries |

## Category 1: Generic Types

### Maybe[T]

The `Maybe` type represents an optional value — either `Some(value)` or `None`.

```compact
// Maybe type in Compact
type Maybe<T> = Either<T, ()>;

// Creating Maybe values
let some_value: Maybe<Field> = some(42);
let none_value: Maybe<Field> = none();

// Pattern matching
match some_value {
  some(x) => x + 1,    // x = 42, returns 43
  none() => 0,          // unreachable for Some
}
```

**When to use:** When a value might be absent — uninitialized state, optional parameters, failed lookups.

### Either[L, R]

`Either` represents a value that is exactly one of two types — left or right.

```compact
type Either<L, R> = match { Left(L) => L, Right(R) => R };

// Use Either for error handling where you need two different types
let result: Either<Error, Field> = left(ERR_NOT_FOUND);
let success: Either<Error, Field> = right(42);

match result {
  left(err) => handle_error(err),
  right(val) => process(val),
}
```

**When to use:** When you need to distinguish between two different error conditions, or when a function can return two fundamentally different types.

## Category 2: Merkle Trees

Merkle trees enable efficient and private membership proofs.

### MerkleTree

```compact
// Merkle tree structure
contract MerkleVerifier {
  state {
    field root: Field;
  }

  // Verify a Merkle proof
  transition verify(
    leaf: Field,
    path: [Field; 32],  // 32 levels for 2^32 leaves
    proof: [Field; 31]   // Sibling nodes at each level
  ) -> bool {
    // Start with the leaf
    let mut current = leaf;

    // Hash up the tree
    for i in 0..31 {
      let sibling = proof[i];
      // Sort left/right (always hash smaller first for determinism)
      current = if current < sibling {
        poseidon_hash(current, sibling)
      } else {
        poseidon_hash(sibling, current)
      };
    }

    // Compare to stored root
    return current == self.root;
  }
}
```

### Real-World Pattern: Private Airdrop

```compact
// Merkle tree for private token airdrop
// Airdrop contract stores Merkle root; users prove eligibility privately
contract MerkleAirdrop {
  state {
    field merkle_root: Field;
    field claimed_nullifiers: Set<Field>;
    field token_address: Address;
  }

  transition claim(
    leaf_index: u64,
    amount: Field,
    proof: [Field; 31],
    path: [Field; 32],
    nullifier: Field
  ) {
    // Prevent double-claim
    constrain !self.claimed_nullifiers.contains(nullifier);
    self.claimed_nullifiers.insert(nullifier);

    // Derive leaf from nullifier + amount
    let leaf = pedersen_hash(nullifier, amount);

    // Verify Merkle proof
    let root = compute_merkle_root(leaf, proof, path);
    constrain root == self.merkle_root;

    // Transfer tokens
    token.transfer(ctx.sender(), amount);
  }
}
```

## Category 3: Elliptic Curve Operations

### Point and Basic Operations

```compact
// EC point representation
type Point = (Field, Field);  // (x, y) coordinates

// Point at infinity (identity)
const POINT_AT_INFINITY: Point = (0, 0);

// Addition: P + Q
transition ec_add(p: Point, q: Point) -> Point {
  // ... BN254 addition logic
}

// Scalar multiplication: k * P
transition ec_mul(k: Field, p: Point) -> Point {
  // Double-and-add algorithm
}

// Multi-scalar multiplication: a*P + b*Q
transition ec_mul_add(a: Field, p: Point, b: Field, q: Point) -> Point {
  return ec_add(ec_mul(a, p), ec_mul(b, q));
}
```

**Practical Use: Timelock Puzzles**

```compact
contract Timelock {
  state {
    field beneficiary: Address;
    field release_time: u64;
    field escrow_pk: Point;  // Escrow public key
  }

  transition reveal(secret: Field) {
    let caller = ctx.sender();
    constrain caller == self.beneficiary;

    let current_time = block_number();
    constrain current_time >= self.release_time;

    // Verify timelock opens with this secret
    let derived_pk = ec_mul(secret, GENERATOR_POINT);
    constrain derived_pk == self.escrow_pk;
  }
}
```

## Category 4: Kernel Types

### ContractAddress

```compact
// Built-in contract address type
const self_address: ContractAddress = ctx.self();

// Check if called by a specific contract
transition only_from_verifier() {
  let caller: ContractAddress = ctx.caller();
  let expected: ContractAddress = 0x1234...;
  constrain caller == expected;
}
```

### ZswapCoinPublicKey & UserAddress

```compact
// Zswap public key for shielded transactions
const zkp_key: ZswapCoinPublicKey = derive_zkp_key(secret);

// User address type
const user: UserAddress = ctx.sender();
```

### ShieldedCoinInfo

```compact
// Shielded transaction metadata
struct ShieldedCoinInfo {
  coin_code: Field,       // Unique coin identifier
  pub_key: ZswapCoinPublicKey,
  value: Field,           // Private amount
  blinding: Field,         // Randomness for hiding
}
```

## Category 5: Helper Circuits

### nativeToken

```compact
// Get the native token address for fee payment
const native: Address = nativeToken();

// Check token type
transition pay_fees() {
  let token = nativeToken();
  // ... transfer fees
}
```

### tokenType

```compact
// Query the type of a token
transition get_token_info(token_addr: Address) -> (string, u8) {
  let (symbol, decimals) = tokenType(token_addr);
  return (symbol, decimals);
}
```

### evolveNonce

```compact
// Evolve nonce for sequential operations
transition evolve(old_nonce: Field) -> Field {
  // Ensures operations happen in order
  let new_nonce = poseidon_hash(old_nonce, ctx.tx_hash());
  return new_nonce;
}
```

### shieldedBurnAddress

```compact
// The null address for burned tokens
const burn: Address = shieldedBurnAddress();

transition burn_tokens(amount: Field) {
  token.transfer(burn, amount);
}
```

## Category 6: Shielded Token Operations

### mint

```compact
// Mint new shielded tokens
transition mint_to(recipient: ZswapCoinPublicKey, amount: Field, blinding: Field) {
  // Create shielded coin
  let coin = ShieldedCoinInfo {
    coin_code: ctx.tx_hash(),
    pub_key: recipient,
    value: amount,
    blinding: blinding,
  };

  // Record in private state
  self.shielded_coins.insert(pedersen_hash(coin));
}
```

### burn

```compact
// Burn shielded tokens (destroy privacy)
transition burn(amount: Field, nullifier: Field) {
  // Prove you own the coins being burned
  constrain self.nullifiers.contains(nullifier);
  self.nullifiers.insert(nullifier);

  // Send to burn address
  token.transfer(shieldedBurnAddress(), amount);
}
```

### transfer (Shielded)

```compact
// Private transfer between two parties
transition shielded_transfer(
  recipient: ZswapCoinPublicKey,
  amount: Field,
  change_nullifier: Field,
  recipient_nullifier: Field,
  proof: Proof
) {
  // Verify ZK proof
  verify_proof(proof, recipient, amount, change_nullifier, recipient_nullifier);

  // Record recipient nullifier (not amount!)
  self.recipient_nullifiers.insert(recipient_nullifier);
  self.change_nullifiers.insert(change_nullifier);
}
```

## Category 7: Block & Time Queries

```compact
// Current block number
let current_block: u64 = block_number();

// Block timestamp (in seconds)
let current_time: u64 = timestamp();

// Time-based unlock
transition withdraw() {
  constrain timestamp() >= self.unlock_time;
  // ... transfer
}
```

## Quick Reference Table

| Export | Type | Description |
|--------|------|-------------|
| `Maybe<T>` | Generic | Optional value (Some/None) |
| `Either<L,R>` | Generic | Union of two types |
| `MerkleTree` | Struct | Merkle tree verification |
| `poseidon_hash(a,b)` | Function | ZK-friendly hash |
| `ec_add(p,q)` | Function | EC point addition |
| `ec_mul(k,p)` | Function | EC scalar multiplication |
| `ContractAddress` | Type | Smart contract address |
| `ZswapCoinPublicKey` | Type | Shielded tx public key |
| `UserAddress` | Type | Regular user address |
| `nativeToken()` | Function | Get native token address |
| `tokenType(addr)` | Function | Get token metadata |
| `evolveNonce(n)` | Function | Sequential nonce evolution |
| `shieldedBurnAddress()` | Function | Null address for burning |
| `mint_to(pk, amt, blind)` | Function | Mint shielded tokens |
| `burn(nullifier, amt)` | Function | Burn shielded tokens |
| `block_number()` | Function | Current block height |
| `timestamp()` | Function | Current Unix timestamp |

## Conclusion

The Compact standard library covers all the essential ZK primitives you need:
- **Generic types** for safe optional/result handling
- **Merkle trees** for private membership proofs
- **EC operations** for cryptographic constructions
- **Kernel types** for Midnight's address model
- **Helper circuits** for token operations
- **Shielded ops** for privacy-preserving transfers
- **Block/time** for time-sensitive logic

Bookmark this guide and refer to it when designing new contracts.

---

*Author: 一筒 | GitHub: D2758695161*
