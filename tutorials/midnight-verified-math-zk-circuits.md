# Tutorial: Verified Math in ZK Circuits: Division, Exchange Rates & Overflow Handling

**Bounty Issue**: #298

## Introduction

Zero-knowledge (ZK) circuits operate under different arithmetic rules than standard programs. Addition and multiplication are cheap, but division, comparison, and overflow handling require special care. This tutorial teaches you how to implement mathematically correct, overflow-safe operations in Compact circuits for Midnight.

## The Problem: Division in Finite Fields

In standard programming, division is straightforward:

```python
result = numerator / denominator  # Floating-point or integer division
```

In ZK circuits, all operations happen in a finite field (typically a large prime). Division requires finding the **multiplicative inverse**:

```
a / b = a * b^(-1) mod p
```

where `b^(-1)` satisfies `b * b^(-1) = 1 mod p`.

### Why This Matters for Exchange Rates

Consider a DEX with a constant-product formula: `x * y = k`

To calculate the output amount when exchanging tokens:
```
output = (input_amount * input_reserve - fee) / (input_reserve + input_amount)
```

In Solidity, this is one line. In a ZK circuit, you must explicitly compute the multiplicative inverse for every division.

## Compact's Arithmetic Model

Compact circuits use **rank-1 constraints** over a finite field. Every operation must be expressed as polynomial constraints.

```compact
// In Compact, basic field operations are native
let a: Field = 5;
let b: Field = 3;
let sum = a + b;      // Native addition
let product = a * b;  // Native multiplication
// Division requires explicit inverse
```

## Implementation: Safe Division

### Method 1: Fused Multiply-Divide (Recommended for Constants)

When the divisor is known at compile time, pre-compute its inverse:

```
let divisor_inverse = inverse(3);  // Pre-compute once
let result = numerator * divisor_inverse;
```

### Method 2: Runtime Inverse (Dynamic Divisors)

```compact
// Compute multiplicative inverse at runtime
transition divide_with_inverse(numerator: Field, divisor: Field) -> Field {
  // Ensure divisor is not zero
  constrain divisor != 0;

  // Compute inverse using Fermat's little theorem: x^(-1) = x^(p-2) mod p
  // Compact provides a built-in for this
  let divisor_inv = invert(divisor);
  return numerator * divisor_inv;
}
```

**Important**: `invert()` is computationally expensive (roughly 100x the cost of multiplication). Cache inverses when the divisor is reused.

## Implementation: Exchange Rate Calculations

Exchange rates require precise fixed-point arithmetic. Here's how to implement a fee-on-transfer swap in Compact:

```compact
contract Swap {
  state {
    field reserve_a: Field;
    field reserve_b: Field;
    field fee_bps: u64;  // Fee in basis points (e.g., 30 = 0.3%)
  }

  // Calculate output amount using constant-product formula
  // output = (input * reserve_out * (10000 - fee)) / (reserve_in + input * 10000 / (10000 - fee))
  transition get_output_amount(input_amount: Field, is_a_to_b: bool) -> Field {
    let reserve_in = is_a_to_b ? self.reserve_a : self.reserve_b;
    let reserve_out = is_a_to_b ? self.reserve_b : self.reserve_a;

    // Fee calculation with integer math
    let fee_multiplier: Field = 10000 - self.fee_bps as Field;
    let numerator = input_amount * reserve_out * fee_multiplier;
    let denominator = reserve_in * 10000 + input_amount * fee_multiplier;

    // Division via multiplicative inverse
    let denominator_inv = invert(denominator);
    return numerator * denominator_inv;
  }
}
```

## Handling Overflow in ZK Circuits

ZK field elements have a fixed range (typically ~2^254 for BN254). Overflow is not detected — it wraps around silently. Prevention is the developer's responsibility.

### Pattern 1: Range Checks

```compact
// Ensure a value fits within expected bounds before use
transition transfer_with_bounds(
  from: Address,
  to: Address,
  amount: Field,
  max_transfer: Field
) {
  // Range check: amount must be within bounds
  constrain amount <= max_transfer;

  // Balance check
  constrain self.balances[from] >= amount;

  // Proceed with transfer
  self.balances[from] -= amount;
  self.balances[to] += amount;
}
```

### Pattern 2: Split Arithmetic (For Large Numbers)

When operating on numbers that might overflow field multiplication:

```compact
// Multiply two 128-bit numbers safely in a 254-bit field
transition safe_multiply(a: Field, b: Field) -> Field {
  // Split into high/low parts
  let a_high = a >> 128;
  let a_low = a & ((1 << 128) - 1);
  let b_high = b >> 128;
  let b_low = b & ((1 << 128) - 1);

  // Compute partial products
  let low_low = a_low * b_low;
  let cross = a_low * b_high + a_high * b_low;

  // Reconstruct (cross must fit in field after shifting)
  return low_low + (cross << 128);
}
```

### Pattern 3: Checking Addition Overflow

```compact
// Safe addition with overflow check
transition safe_add(a: Field, b: Field, max_val: Field) -> Field {
  let result = a + b;
  // Verify no overflow: result >= a implies no wrap
  constrain result >= a;
  // Verify within bounds
  constrain result <= max_val;
  return result;
}
```

## Comparison Operations

ZK circuits don't have native comparison operators. Implement them via range constraints:

```compact
// Check if a <= b (assuming a, b are within [0, MAX_VAL])
transition is_le(a: Field, b: Field, bit_size: u64) -> bool {
  let diff = b - a;
  // diff is in [0, MAX_VAL] if a <= b
  // diff is in [FIELD_MAX-MAX_VAL, FIELD_MAX] if a > b
  // We check if diff fits in `bit_size` bits
  constrain diff.to_bits(bit_size) == diff;  // Fails if diff requires more bits
  return true;
}
```

## Practical Example: Weighted Portfolio Rebalancing

```compact
// Rebalance a portfolio to target weights
// target_amount_i = total_value * target_weight_i / sum_weights
transition rebalance(
  current_amounts: [Field; 3],
  prices: [Field; 3],
  target_weights: [Field; 3],
  total_value: Field
) -> [Field; 3] {
  // Step 1: Calculate sum of weights
  let weight_sum = target_weights[0] + target_weights[1] + target_weights[2];
  let weight_sum_inv = invert(weight_sum);

  // Step 2: Calculate target amounts for each asset
  let target_0 = total_value * target_weights[0] * weight_sum_inv;
  let target_1 = total_value * target_weights[1] * weight_sum_inv;
  let target_2 = total_value * target_weights[2] * weight_sum_inv;

  // Step 3: Calculate deltas and execute trades
  // (simplified — full version would check balances and execute swaps)
  return [target_0, target_1, target_2];
}
```

## Security Checklist

- [ ] **Never divide without checking for zero** — `invert(0)` causes constraint failure
- [ ] **Cache expensive inverses** — `invert()` is ~100x more expensive than multiplication
- [ ] **Add range checks before arithmetic** that depends on results
- [ ] **Use fixed-point arithmetic for decimals** — multiply before dividing
- [ ] **Pre-compute constant inverses** at compile time when possible
- [ ] **Test edge cases**: 0, 1, MAX_VAL, near-boundary values

## Testing Strategies

```bash
# Test division by zero
compact invoke Divide.invert --args 0  # Should fail

# Test overflow
compact invoke SafeAdd.safe_add --args MAX_VAL 1  # Should fail

# Test exchange rate precision
compact test ExchangeRate --cases ./tests/exchange-rate.json
```

## Conclusion

Verified math in ZK circuits requires explicit handling of:
- **Division** via multiplicative inverses (expensive — cache when possible)
- **Overflow** via range checks and split arithmetic
- **Comparison** via bit-length constraints

Compact's field-native arithmetic makes addition and multiplication cheap, but division and comparison require careful implementation. Use the patterns in this tutorial as a foundation for building numerically robust Midnight applications.

---

*Author: 一筒 | GitHub: D2758695161*
