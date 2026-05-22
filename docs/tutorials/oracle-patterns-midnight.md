## Bringing External Data On-Chain: Oracle Patterns for Midnight Compact

**Difficulty:** Intermediate  
**Time:** 25 minutes  
**Bounty:** #304

---

### Overview

Blockchains are isolated systems — they can't natively access external data like stock prices, weather, or API results. Oracles bridge this gap. In Midnight, oracles publish data on-chain so smart contracts can use it while preserving privacy where needed.

### What You'll Learn

- Oracle design patterns for Midnight
- Private vs public oracle data
- Building a price feed oracle
- Verifying oracle authenticity

### Oracle Architecture

```
External API ──► Oracle Node ──► Midnight Contract
                                     │
                              ┌──────┴──────┐
                              │  Public Data │  Private Data
                              │  (commitment)│  (encrypted)
                              └──────────────┘
```

### Step 1: Simple Public Oracle

```javascript
// contracts/price-oracle/index.compact

import { LEDGER, SEED } from "std";

export const PriceOracle = contract(() => {
    const prices: Map<u8, u64>;  // assetId -> price (scaled * 10000)
    const owner: [u8; 32];       // oracle operator
    
    export function initialize(): void {
        owner = SEED.publicKey;
    }
    
    // Oracle updates a price
    export function updatePrice(assetId: u8, price: u64): void {
        require(SEED.publicKey == owner, "Only oracle can update");
        require(price > 0, "Price must be positive");
        
        prices.set(assetId, price);
        
        // Emit event for off-chain listeners
        emit("PriceUpdated", assetId, price, SEED.height);
    }
    
    // Anyone can read current price
    export function getPrice(assetId: u8): u64 {
        const p = prices.get(assetId);
        require(p !== null, "Asset not tracked");
        return p;
    }
});
```

### Step 2: Oracle CLI Tool

```bash
#!/bin/bash
# oracle-publisher.sh - Publish prices to Midnight

ASSET_IDS=(
    "1:BNB/USD"
    "2:BTC/USD" 
    "3:ETH/USD"
    "4:SOL/USD"
    "5:ADA/USD"
)

PRICES_URL="https://api.binance.com/api/v3/ticker/price"

while true; do
    echo "=== Fetching prices: $(date) ==="
    
    for entry in "${ASSET_IDS[@]}"; do
        id="${entry%%:*}"
        symbol="${entry##*:}"
        pair="${symbol/\//}"

        # Fetch from exchange
        price=$(curl -s "$PRICES_URL?symbol=${pair}" | \
            python3 -c "import json,sys; d=json.load(sys.stdin); print(int(float(d.get('price',0))*10000))" 2>/dev/null)
        
        if [ -n "$price" ] && [ "$price" -gt 0 ]; then
            echo "  $symbol: $price (scaled)"
            # Publish to contract
            # midnight contract call price-oracle updatePrice \
            #     --args "{\"assetId\":$id,\"price\":$price}" \
            #     --signer keys/oracle-key.json \
            #     --network testnet
        fi
    done
    
    sleep 300  # Update every 5 minutes
done
```

### Step 3: Verified Oracle with Signatures

For higher trust, add signature verification so consumers can verify the data source:

```javascript
// contracts/verified-oracle/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

export const VerifiedOracle = contract(() => {
    const authorizedKeys: Map<[u8; 32], u8>;  // pubkey -> weight
    const dataPoints: Map<u8, DataPoint>;
    
    struct DataPoint {
        value: u64;
        timestamp: u64;
        source: [u8; 32];
        confidence: u8;  // 0-100
    }
    
    // Register an authorized oracle key
    export function authorizeOracle(pubkey: [u8; 32], weight: u8): void {
        require(SEED.publicKey == DEPLOYER, "Deployer only");
        authorizedKeys.set(pubkey, weight);
    }
    
    // Submit data with signature verification
    export function submitData(
        assetId: u8,
        value: u64,
        signature: [u8; 64]
    ): void {
        const weight = authorizedKeys.get(SEED.publicKey);
        require(weight !== null, "Unauthorized oracle");
        
        // Verify the data was signed by this oracle
        const msg = concat(assetId, value, SEED.height);
        require(
            VERIFIER.verifySignature(SEED.publicKey, msg, signature),
            "Invalid signature"
        );
        
        dataPoints.set(assetId, DataPoint(
            value,
            SEED.timestamp,
            SEED.publicKey,
            weight
        ));
    }
});
```

### Step 4: Consumer Contract

```javascript
// contracts/defi-app/index.compact

export const DeFiApp = contract(() => {
    const ORACLE_ADDRESS: address = "0xORACLE_CONTRACT";
    
    // Use oracle data to make decisions
    export function checkLiquidation(user: [u8; 32]): void {
        // Cross-contract call to get price
        const btcPrice = call(ORACLE_ADDRESS, "getPrice", [1]);
        
        // Check liquidation threshold
        if (btcPrice < 20000_0000) { // $20,000
            // Trigger liquidation
            emit("LiquidationTriggered", user, btcPrice);
        }
    }
});
```

### Oracle Security Patterns

| Pattern | Description | When to Use |
|---------|-------------|-------------|
| Single Oracle | One trusted source | Low-value, internal apps |
| Multi-Sig Oracle | Multiple oracles sign | Medium-value protocols |
| Median Oracle | Use median of N oracles | High-value DeFi |
| Time-Weighted | TWAP over sliding window | Volatile assets |
| Staked Oracle | Oracles stake collateral | Decentralized feeds |

### Step 5: Running a Private Oracle

For sensitive data that shouldn't be public on-chain:

```javascript
// Oracle publishes encrypted data visible only to authorized consumers
export function submitPrivateData(
    consumerKey: [u8; 32],
    encryptedData: [u8; 256]
): void {
    require(authorizedKeys.contains(SEED.publicKey), "Unauthorized");
    
    // Store encrypted — only consumerKey can decrypt off-chain
    privateData.set(consumerKey, encryptedData);
}
```

### Summary

- Oracles connect external data to Midnight contracts
- Public oracles are verifiable but data is visible to all
- Signature-verified oracles provide higher trust
- Multi-oracle median feeds resist manipulation
- Private oracles enable confidential data feeds
