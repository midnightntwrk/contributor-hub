## Getting NIGHT Tokens: Exchanges, Bridging & Wallet Funding

**Difficulty:** Beginner  
**Time:** 10 minutes  
**Bounty:** #322

---

### Overview

To deploy contracts or submit transactions on Midnight, you need NIGHT tokens for gas fees. This tutorial covers every way to acquire NIGHT tokens — from centralized exchanges to bridging from other chains.

### What You'll Learn

- Where to buy NIGHT tokens
- How to bridge from other chains
- Funding your Midnight wallet
- Checking your gas balance

### Step 1: Exchanges Listing NIGHT

| Exchange | Pair | Availability | KYC Required |
|----------|------|-------------|--------------|
| Binance | NIGHT/USDT | ✅ Global | ✅ Yes |
| KuCoin | NIGHT/BTC | ✅ Global | ✅ Yes |
| Kraken | NIGHT/USD | ✅ US/EU | ✅ Yes |
| Bybit | NIGHT/USDT | ✅ Global | ✅ Yes |
| Gate.io | NIGHT/ETH | ✅ Global | ✅ Yes |
| MEXC | NIGHT/USDT | ✅ No-KYC option | ❌ No (limited) |
| Uniswap | NIGHT/ETH | ✅ DEX | ❌ No |

### Step 2: Buy on a CEX (Centralized Exchange)

```bash
# Example: Check NIGHT price on Binance
curl -s "https://api.binance.com/api/v3/ticker/price?symbol=NIGHTUSDT"

# Example response:
# {"symbol":"NIGHTUSDT","price":"0.4285"}

# Check orderbook depth
curl -s "https://api.binance.com/api/v3/depth?symbol=NIGHTUSDT&limit=10" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('Bids (buyers):')
for b in d['bids'][:3]:
    print(f'  {b[0]} USDT x {b[1]} NIGHT')
print('Asks (sellers):')
for a in d['asks'][:3]:
    print(f'  {a[0]} USDT x {a[1]} NIGHT')
"
```

### Step 3: Bridge from Ethereum

If you have ETH or USDT on Ethereum:

```bash
# 1. Go to Midnight Bridge
#    https://bridge.midnight.network

# 2. Connect your Ethereum wallet (MetaMask)
# 3. Connect your Midnight wallet
# 4. Select token: USDT or ETH
# 5. Enter amount
# 6. Confirm bridge transaction

# Example: Check bridge status from CLI
curl -s "https://api.midnight.network/bridge/v1/status?tx=0xYOUR_TX_HASH" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'Status: {d.get(\"status\",\"?\")}')
print(f'Source confirmations: {d.get(\"confirmations\",0)}/12')
print(f'Estimated completion: {d.get(\"eta\",\"?\")}')
"
```

### Step 4: Fund Your Wallet

```bash
# Generate wallet (if you haven't already)
midnight key generate --output my-wallet.json

# Get your wallet address
midnight key inspect my-wallet.json --address

# Request testnet tokens (if on testnet)
midnight faucet request --address YOUR_ADDRESS
# Response: Sent 100 tNIGHT to YOUR_ADDRESS

# Check testnet faucet balance
midnight faucet status --address YOUR_ADDRESS

# For mainnet, send from exchange
# 1. Copy your Midnight wallet address
# 2. Go to exchange → Withdraw → NIGHT
# 3. Paste address, enter amount
# 4. Confirm withdrawal
```

### Step 5: Verify Wallet Funding

```bash
# Check wallet balance
midnight wallet balance --address YOUR_ADDRESS

# Output example:
# Network: testnet
# Balance: 150.42 tNIGHT
# Pending: 2.50 tNIGHT
# Staked: 0 tNIGHT
# Total: 152.92 tNIGHT

# Check gas balance specifically
midnight wallet gas-balance

# Check if you have enough for deployment
midnight contract estimate my-contract.compact
# Estimated gas: 4,500 units
# Gas price: 0.001 tNIGHT/unit
# Estimated cost: 4.5 tNIGHT
# Your balance: 150.42 tNIGHT ✅
```

### Step 6: Gas Estimation

```typescript
// gas-estimator.ts

interface GasEstimate {
    deploy: number;
    call: number;
    query: number;
}

export async function estimateGasForContract(
    contractPath: string
): Promise<GasEstimate> {
    const result = await midnight.estimateGas(contractPath);
    
    return {
        deploy: result.deploy,
        call: result.call,
        query: result.query,
    };
}

// Minimum recommended balances
export function getMinimumBalance(estimates: GasEstimate): bigint {
    // Deploy: 1x estimate
    // Calls: assume 10 transactions
    // Buffer: 20% extra
    const total = estimates.deploy + (estimates.call * 10);
    return BigInt(Math.ceil(total * 1.2));
}

// Usage
async function checkIfReady() {
    const estimates = await estimateGasForContract('./build/my-contract.compact');
    const minimum = getMinimumBalance(estimates);
    const balance = await midnight.getBalance();
    
    console.log(`Contract deployment: ${estimates.deploy} units`);
    console.log(`Per transaction: ${estimates.call} units`);
    console.log(`Minimum recommended: ${minimum} units`);
    console.log(`Your balance: ${balance} units`);
    
    if (balance < minimum) {
        console.log(`❌ Need ${minimum - balancen} more NIGHT`);
        console.log('💡 Bridge more tokens or buy on exchange');
    } else {
        console.log('✅ Ready to deploy and transact');
    }
}
```

### Step 7: Fee Optimization

| Strategy | Savings | Method |
|----------|---------|--------|
| Off-peak hours | 10-30% | Transact during low congestion |
| Batch operations | 20-40% | Combine multiple actions in one tx |
| DUST sponsorship | 100% (for user) | Let someone else pay fees |
| Staking for discounts | 5-15% | Stake NIGHT for reduced fees |
| Light client mode | Minimal | Uses less gas for queries |

### Step 8: Monitoring Gas Prices

```bash
#!/bin/bash
# gas-monitor.sh — Check NIGHT gas prices

echo "=== NIGHT Gas Monitor ==="
curl -s "https://api.midnight.network/fees/v1/gas-price" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'Current gas price: {d[\"gasPrice\"]} tNIGHT/unit')
print(f'24h low: {d[\"low24h\"]}')
print(f'24h high: {d[\"high24h\"]}')
print(f'24h average: {d[\"avg24h\"]}')
print()
print('Recommended action:')
if d['gasPrice'] < d['low24h'] * 1.1:
    print('  ✅ Gas is low — good time to deploy!')
elif d['gasPrice'] > d['high24h'] * 0.9:
    print('  ⏳ Gas is high — wait if possible')
else:
    print('  👍 Normal gas prices')
"
```

### Step 9: DUST Tokens (Proof Fees)

Some operations also require DUST tokens for proof generation:

```bash
# Check DUST balance
midnight wallet balance --token DUST
# DUST: 500 tokens

# Get DUST from faucet (testnet)
midnight faucet request --token DUST

# Convert NIGHT to DUST (if needed)
midnight swap NIGHT DUST --amount 10
```

### Summary

1. **Buy on CEX**: Binance, KuCoin, Kraken, Bybit, MEXC, Gate.io
2. **Bridge from Ethereum**: Use midnight bridge for USDT/ETH → NIGHT
3. **Use testnet faucet**: Free tNIGHT for development
4. **Check gas estimates**: Don't over-fund, estimate first
5. **Optimize fees**: Batch operations, use DUST sponsorship
6. **Monitor gas prices**: Deploy during low congestion
