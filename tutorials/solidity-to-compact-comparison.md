# Solidity to Compact: A Comprehensive Comparison Guide

A side-by-side comparison of common Solidity patterns and their Compact equivalents for developers transitioning to Midnight's privacy-first smart contract language.

## Table of Contents

1. [Basic Structure](#basic-structure)
2. [State Variables](#state-variables)
3. [Functions](#functions)
4. [Mappings](#mappings)
5. [Events](#events)
6. [Modifiers & Access Control](#modifiers--access-control)
7. [Loops](#loops)
8. [Error Handling](#error-handling)
9. [Privacy Features](#privacy-features)
10. [Key Differences](#key-differences)

---

## Basic Structure

### Solidity
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    // Contract body
}
```

### Compact
```compact
// Compact contract structure
contract MyContract {
    // Contract body
}
```

**Key Difference:** Compact uses `.compact` file extension and has built-in privacy features.

---

## State Variables

### Solidity
```solidity
contract StateExample {
    uint256 public count;
    address public owner;
    bool public paused;
    string public name;
    
    constructor() {
        owner = msg.sender;
        count = 0;
        paused = false;
        name = "MyContract";
    }
}
```

### Compact
```compact
contract StateExample {
    // Private by default in Compact
    private count: Uint<64>;
    private owner: Address;
    private paused: Boolean;
    private name: Bytes<32>;
    
    constructor() {
        owner = caller();
        count = 0;
        paused = false;
        name = "MyContract";
    }
}
```

**Key Differences:**
- Compact uses `Uint<64>` instead of `uint256`
- Variables are **private by default** in Compact
- Use `caller()` instead of `msg.sender`
- Strings use `Bytes<N>` with fixed length

---

## Functions

### Solidity
```solidity
contract FunctionExample {
    uint256 public value;
    
    // Public function
    function setValue(uint256 _value) public {
        value = _value;
    }
    
    // View function
    function getValue() public view returns (uint256) {
        return value;
    }
    
    // Pure function
    function add(uint256 a, uint256 b) public pure returns (uint256) {
        return a + b;
    }
}
```

### Compact
```compact
contract FunctionExample {
    private value: Uint<64>;
    
    // Public function
    public setValue(_value: Uint<64>): Void {
        value = _value;
    }
    
    // View function (read-only)
    public getValue(): Uint<64> {
        return value;
    }
    
    // Pure function
    public add(a: Uint<64>, b: Uint<64>): Uint<64> {
        return a + b;
    }
}
```

**Key Differences:**
- Compact uses `public` keyword before function name
- Return type comes after colon `:`
- Use `Void` for functions with no return value
- No `view` or `pure` modifiers needed

---

## Mappings

### Solidity
```solidity
contract MappingExample {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    
    function setBalance(address _user, uint256 _amount) public {
        balances[_user] = _amount;
    }
    
    function getBalance(address _user) public view returns (uint256) {
        return balances[_user];
    }
}
```

### Compact
```compact
contract MappingExample {
    private balances: Map<Address, Uint<64>>;
    private allowances: Map<Address, Map<Address, Uint<64>>>;
    
    public setBalance(_user: Address, _amount: Uint<64>): Void {
        balances[_user] = _amount;
    }
    
    public getBalance(_user: Address): Uint<64> {
        return balances[_user];
    }
}
```

**Key Differences:**
- Compact uses `Map<KeyType, ValueType>` syntax
- Nested mappings use `Map<KeyType, Map<KeyType, ValueType>>`
- Same access pattern with bracket notation

---

## Events

### Solidity
```solidity
contract EventExample {
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    
    function transfer(address _to, uint256 _amount) public {
        // Transfer logic...
        emit Transfer(msg.sender, _to, _amount);
    }
}
```

### Compact
```compact
contract EventExample {
    // Events are declared with 'event' keyword
    event Transfer(from: Address, to: Address, amount: Uint<64>);
    event Approval(owner: Address, spender: Address, amount: Uint<64>);
    
    public transfer(_to: Address, _amount: Uint<64>): Void {
        // Transfer logic...
        emit Transfer(caller(), _to, _amount);
    }
}
```

**Key Differences:**
- Similar syntax but with Compact type system
- Use `emit` keyword to fire events
- No `indexed` keyword needed (Compact handles this automatically)

---

## Modifiers & Access Control

### Solidity
```solidity
contract AccessExample {
    address public owner;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    function sensitiveAction() public onlyOwner {
        // Only owner can call this
    }
}
```

### Compact
```compact
contract AccessExample {
    private owner: Address;
    
    constructor() {
        owner = caller();
    }
    
    // Inline access control
    public sensitiveAction(): Void {
        assert(caller() == owner, "Not owner");
        // Only owner can call this
    }
}
```

**Key Differences:**
- Compact uses `assert()` for access control
- No modifier syntax (use inline assertions)
- More explicit and readable

---

## Loops

### Solidity
```solidity
contract LoopExample {
    uint256[] public numbers;
    
    function processNumbers() public {
        for (uint256 i = 0; i < numbers.length; i++) {
            if (numbers[i] > 100) {
                numbers[i] = numbers[i] * 2;
            }
        }
    }
    
    function sumNumbers() public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < numbers.length; i++) {
            total += numbers[i];
        }
        return total;
    }
}
```

### Compact
```compact
contract LoopExample {
    private numbers: Array<Uint<64>>;
    
    public processNumbers(): Void {
        for i in 0..numbers.length {
            if numbers[i] > 100 {
                numbers[i] = numbers[i] * 2;
            }
        }
    }
    
    public sumNumbers(): Uint<64> {
        let total: Uint<64> = 0;
        for i in 0..numbers.length {
            total = total + numbers[i];
        }
        return total;
    }
}
```

**Key Differences:**
- Compact uses `for i in start..end` syntax
- Arrays use `Array<Type>` syntax
- Use `let` for variable declarations

---

## Error Handling

### Solidity
```solidity
contract ErrorExample {
    error InsufficientBalance(uint256 requested, uint256 available);
    
    function withdraw(uint256 _amount) public {
        if (_amount > balance) {
            revert InsufficientBalance(_amount, balance);
        }
        // Or use require
        require(_amount <= balance, "Insufficient balance");
    }
}
```

### Compact
```compact
contract ErrorExample {
    public withdraw(_amount: Uint<64>): Void {
        assert(_amount <= balance, "Insufficient balance");
        // Withdraw logic...
    }
}
```

**Key Differences:**
- Compact uses `assert()` for error handling
- No custom error types (use string messages)
- Simpler error handling model

---

## Privacy Features

### Solidity (No Built-in Privacy)
```solidity
// All state is public on-chain
contract NoPrivacy {
    uint256 public secret; // Anyone can read this
    mapping(address => uint256) public balances; // All balances visible
}
```

### Compact (Privacy-First)
```compact
contract PrivacyExample {
    // Private by default
    private secret: Uint<64>; // Only contract can read
    private balances: Map<Address, Uint<64>>; // Balances hidden
    
    // Selective disclosure
    public getMyBalance(): Uint<64> {
        // User can only see their own balance
        return balances[caller()];
    }
    
    // Zero-knowledge proof support
    public proveBalance(threshold: Uint<64>): Boolean {
        // Prove balance > threshold without revealing exact amount
        return zkProof(balances[caller()] > threshold);
    }
}
```

**Key Differences:**
- Compact has **built-in privacy** by default
- State is hidden unless explicitly exposed
- Zero-knowledge proofs integrated
- Selective disclosure possible

---

## Key Differences Summary

| Feature | Solidity | Compact |
|---------|----------|---------|
| **Privacy** | Public by default | Private by default |
| **State Visibility** | All on-chain | Hidden by default |
| **Type System** | uint256, address | Uint<64>, Address |
| **Access Control** | Modifiers | Inline assertions |
| **Error Handling** | require/revert | assert() |
| **Events** | emit | emit |
| **Mappings** | mapping(k => v) | Map<K, V> |
| **Arrays** | uint256[] | Array<Uint<64>> |
| **Loops** | for (uint i; ...; ...) | for i in start..end |
| **msg.sender** | msg.sender | caller() |
| **ZK Proofs** | External libraries | Built-in support |

---

## Migration Checklist

When converting Solidity to Compact:

- [ ] Change file extension from `.sol` to `.compact`
- [ ] Update type declarations (uint256 → Uint<64>)
- [ ] Replace `msg.sender` with `caller()`
- [ ] Convert modifiers to inline `assert()` statements
- [ ] Update mapping syntax
- [ ] Change loop syntax to `for i in start..end`
- [ ] Review privacy requirements (make explicit what should be public)
- [ ] Test with privacy features enabled
- [ ] Consider zero-knowledge proof requirements

---

## Resources

- [Midnight Documentation](https://midnight.network/docs)
- [Compact Language Reference](https://midnight.network/docs/reference/compact)
- [Solidity Documentation](https://docs.soliditylang.org/)
- [Aleo Solidity-to-Leo Guide](https://developer.aleo.org/guides/solidity-to-leo/comparison-table/)

---

*Contributed by @iyop666 — Closes #205*
