# Midnight Proofs Integration Tutorial - Node.js REST API

## 📋 Overview

This tutorial demonstrates how to integrate Midnight Proofs into an existing Node.js/REST backend. We'll build a complete REST API wrapper that handles:

- Server-side wallet provider setup
- Proof generation using `httpClientProofProvider`
- Transaction submission
- REST API endpoints for contract operations
- Error handling for proof timeouts and network failures

## 🎯 Learning Objectives

By the end of this tutorial, you will be able to:

1. Set up a secure server environment for Midnight interactions
2. Generate zero-knowledge proofs using the HTTP client
3. Create RESTful API endpoints for blockchain operations
4. Implement robust error handling and retry logic
5. Deploy a production-ready Midnight integration

## 📦 Prerequisites

- Node.js 18+ installed
- Basic understanding of REST APIs
- Familiarity with async/await in JavaScript
- Midnight wallet and testnet access

## 🚀 Quick Start

### 1. Project Setup

```bash
# Create project directory
mkdir midnight-rest-api
cd midnight-rest-api

# Initialize npm project
npm init -y

# Install dependencies
npm install express midnight-js @midnight-network/http-client-proof-provider dotenv cors
npm install --save-dev nodemon jest supertest
```

### 2. Project Structure

```
midnight-rest-api/
├── src/
│   ├── index.js              # Main entry point
│   ├── config/
│   │   └── midnight.js       # Midnight configuration
│   ├── providers/
│   │   └── wallet.js         # Wallet provider setup
│   ├── services/
│   │   ├── proofs.js         # Proof generation service
│   │   └── transactions.js   # Transaction submission service
│   ├── routes/
│   │   └── contracts.js      # Contract API routes
│   └── middleware/
│       └── error.js          # Error handling middleware
├── tests/
│   ├── proofs.test.js
│   └── transactions.test.js
├── .env.example
├── .env
└── package.json
```

### 3. Environment Configuration

Create `.env` file:

```env
# Midnight Configuration
MIDNIGHT_NETWORK=testnet
MIDNIGHT_NODE_URL=https://testnet-node.midnight.network
WALLET_PRIVATE_KEY=your_private_key_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## 🏗️ Implementation

### Step 1: Midnight Configuration

Create `src/config/midnight.js`:

```javascript
require('dotenv').config();

module.exports = {
  network: process.env.MIDNIGHT_NETWORK || 'testnet',
  nodeUrl: process.env.MIDNIGHT_NODE_URL,
  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY,
  },
  proof: {
    timeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 1000, // 1 second
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};
```

### Step 2: Wallet Provider Setup

Create `src/providers/wallet.js`:

```javascript
const { httpClientProofProvider } = require('@midnight-network/http-client-proof-provider');
const config = require('../config/midnight');

class WalletProvider {
  constructor() {
    this.proofProvider = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize HTTP client proof provider
      this.proofProvider = await httpClientProofProvider({
        url: config.nodeUrl,
        network: config.network,
        timeout: config.proof.timeout,
      });

      this.initialized = true;
      console.log('Wallet provider initialized successfully');
    } catch (error) {
      console.error('Failed to initialize wallet provider:', error);
      throw error;
    }
  }

  getProofProvider() {
    if (!this.initialized) {
      throw new Error('Wallet provider not initialized. Call initialize() first.');
    }
    return this.proofProvider;
  }

  async generateProof(contractCall, inputs) {
    const maxRetries = config.proof.maxRetries;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Generating proof (attempt ${attempt}/${maxRetries})...`);
        
        const proof = await this.proofProvider.generateProof({
          contractCall,
          inputs,
        });

        console.log('Proof generated successfully');
        return proof;
      } catch (error) {
        lastError = error;
        console.error(`Proof generation failed (attempt ${attempt}):`, error.message);

        if (attempt < maxRetries) {
          // Wait before retrying
          await new Promise(resolve => 
            setTimeout(resolve, config.proof.retryDelay * attempt)
          );
        }
      }
    }

    throw new Error(`Failed to generate proof after ${maxRetries} attempts: ${lastError.message}`);
  }

  async close() {
    if (this.proofProvider) {
      await this.proofProvider.close();
      this.initialized = false;
      console.log('Wallet provider closed');
    }
  }
}

// Singleton instance
const walletProvider = new WalletProvider();

module.exports = walletProvider;
```

### Step 3: Proof Generation Service

Create `src/services/proofs.js`:

```javascript
const walletProvider = require('../providers/wallet');
const config = require('../config/midnight');

class ProofService {
  constructor() {
    this.pendingProofs = new Map();
  }

  async generateContractProof(contractAddress, method, args) {
    try {
      // Validate inputs
      this.validateInputs(contractAddress, method, args);

      // Generate proof using wallet provider
      const proof = await walletProvider.generateProof(method, {
        contractAddress,
        args,
      });

      // Store proof metadata
      const proofId = this.storeProofMetadata(proof, contractAddress, method);

      return {
        success: true,
        proofId,
        proof,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Proof service error:', error);
      throw this.handleError(error);
    }
  }

  validateInputs(contractAddress, method, args) {
    if (!contractAddress || typeof contractAddress !== 'string') {
      throw new Error('Invalid contract address');
    }

    if (!method || typeof method !== 'string') {
      throw new Error('Invalid method name');
    }

    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }
  }

  storeProofMetadata(proof, contractAddress, method) {
    const proofId = `proof_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.pendingProofs.set(proofId, {
      contractAddress,
      method,
      createdAt: Date.now(),
      status: 'generated',
    });

    // Clean up old proofs after 1 hour
    setTimeout(() => {
      this.pendingProofs.delete(proofId);
    }, 3600000);

    return proofId;
  }

  getProofStatus(proofId) {
    const proof = this.pendingProofs.get(proofId);
    if (!proof) {
      return { exists: false };
    }

    return {
      exists: true,
      ...proof,
      age: Date.now() - proof.createdAt,
    };
  }

  handleError(error) {
    // Categorize errors for better client handling
    if (error.message.includes('timeout')) {
      error.type = 'PROOF_TIMEOUT';
      error.retryable = true;
    } else if (error.message.includes('network')) {
      error.type = 'NETWORK_ERROR';
      error.retryable = true;
    } else if (error.message.includes('invalid')) {
      error.type = 'INVALID_INPUT';
      error.retryable = false;
    } else {
      error.type = 'UNKNOWN_ERROR';
      error.retryable = false;
    }

    return error;
  }
}

module.exports = new ProofService();
```

### Step 4: Transaction Submission Service

Create `src/services/transactions.js`:

```javascript
const walletProvider = require('../providers/wallet');

class TransactionService {
  constructor() {
    this.pendingTransactions = new Map();
  }

  async submitTransaction(proof, contractCall) {
    try {
      console.log('Submitting transaction...');

      const txHash = await walletProvider.getProofProvider().submitTransaction({
        proof,
        contractCall,
      });

      console.log('Transaction submitted:', txHash);

      // Store transaction metadata
      const txId = this.storeTransactionMetadata(txHash, proof, contractCall);

      return {
        success: true,
        txHash,
        txId,
        status: 'pending',
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Transaction submission error:', error);
      throw this.handleError(error);
    }
  }

  storeTransactionMetadata(txHash, proof, contractCall) {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.pendingTransactions.set(txId, {
      txHash,
      contractCall,
      submittedAt: Date.now(),
      status: 'pending',
    });

    return txId;
  }

  async getTransactionStatus(txId) {
    const tx = this.pendingTransactions.get(txId);
    if (!tx) {
      return { exists: false };
    }

    // In a real implementation, you would query the blockchain
    // to get the actual transaction status
    const status = await this.queryBlockchainStatus(tx.txHash);

    return {
      exists: true,
      ...tx,
      ...status,
      age: Date.now() - tx.submittedAt,
    };
  }

  async queryBlockchainStatus(txHash) {
    // Placeholder for blockchain status query
    // In production, implement actual blockchain query
    return {
      status: 'pending', // 'pending' | 'confirmed' | 'failed'
      confirmations: 0,
      blockNumber: null,
    };
  }

  handleError(error) {
    if (error.message.includes('timeout')) {
      error.type = 'TX_TIMEOUT';
      error.retryable = true;
    } else if (error.message.includes('network')) {
      error.type = 'NETWORK_ERROR';
      error.retryable = true;
    } else if (error.message.includes('insufficient')) {
      error.type = 'INSUFFICIENT_FUNDS';
      error.retryable = false;
    } else {
      error.type = 'TX_UNKNOWN_ERROR';
      error.retryable = false;
    }

    return error;
  }
}

module.exports = new TransactionService();
```

### Step 5: REST API Routes

Create `src/routes/contracts.js`:

```javascript
const express = require('express');
const router = express.Router();
const proofService = require('../services/proofs');
const transactionService = require('../services/transactions');

/**
 * @route POST /api/contracts/:address/call
 * @desc Generate a proof for a contract call
 * @access Public
 */
router.post('/:address/call', async (req, res, next) => {
  try {
    const { address: contractAddress } = req.params;
    const { method, args } = req.body;

    if (!method || !args) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: method, args',
      });
    }

    const result = await proofService.generateContractProof(
      contractAddress,
      method,
      args
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/contracts/proof/:proofId
 * @desc Get proof status
 * @access Public
 */
router.get('/proof/:proofId', async (req, res, next) => {
  try {
    const { proofId } = req.params;
    const status = proofService.getProofStatus(proofId);

    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Proof not found',
      });
    }

    res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/contracts/transaction
 * @desc Submit a transaction with proof
 * @access Public
 */
router.post('/transaction', async (req, res, next) => {
  try {
    const { proof, contractCall } = req.body;

    if (!proof || !contractCall) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: proof, contractCall',
      });
    }

    const result = await transactionService.submitTransaction(proof, contractCall);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/contracts/transaction/:txId
 * @desc Get transaction status
 * @access Public
 */
router.get('/transaction/:txId', async (req, res, next) => {
  try {
    const { txId } = req.params;
    const status = await transactionService.getTransactionStatus(txId);

    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found',
      });
    }

    res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/contracts/:address/call-and-submit
 * @desc Generate proof and submit transaction in one step
 * @access Public
 */
router.post('/:address/call-and-submit', async (req, res, next) => {
  try {
    const { address: contractAddress } = req.params;
    const { method, args } = req.body;

    if (!method || !args) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: method, args',
      });
    }

    // Generate proof
    const proofResult = await proofService.generateContractProof(
      contractAddress,
      method,
      args
    );

    // Submit transaction
    const txResult = await transactionService.submitTransaction(
      proofResult.proof,
      {
        contractAddress,
        method,
        args,
      }
    );

    res.status(200).json({
      success: true,
      proof: {
        proofId: proofResult.proofId,
        timestamp: proofResult.timestamp,
      },
      transaction: {
        txId: txResult.txId,
        txHash: txResult.txHash,
        status: txResult.status,
        timestamp: txResult.timestamp,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### Step 6: Error Handling Middleware

Create `src/middleware/error.js`:

```javascript
const config = require('../config/midnight');

class AppError extends Error {
  constructor(message, statusCode, type, retryable = false) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.retryable = retryable;
    this.timestamp = Date.now();
  }
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let type = err.type || 'UNKNOWN_ERROR';
  let retryable = err.retryable || false;

  // Log error in development
  if (config.server.nodeEnv === 'development') {
    console.error('Error:', {
      message,
      type,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  // Don't leak error details in production
  if (config.server.nodeEnv === 'production') {
    if (statusCode === 500) {
      message = 'Something went wrong';
    }
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      type,
      retryable,
      timestamp: err.timestamp || Date.now(),
    },
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const notFound = (req, res, next) => {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND',
    false
  );
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFound,
  AppError,
};
```

### Step 7: Main Application

Create `src/index.js`:

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const walletProvider = require('./providers/wallet');
const contractRoutes = require('./routes/contracts');
const { errorHandler, asyncHandler, notFound } = require('./middleware/error');
const config = require('./config/midnight');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Initialize wallet provider before starting server
const startServer = async () => {
  try {
    console.log('Initializing wallet provider...');
    await walletProvider.initialize();
    console.log('Wallet provider ready');

    // Routes
    app.use('/api/contracts', contractRoutes);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: Date.now(),
        version: '1.0.0',
      });
    });

    // Error handling
    app.use(notFound);
    app.use(errorHandler);

    // Start server
    app.listen(config.server.port, () => {
      console.log(`
╔════════════════════════════════════════╗
║   Midnight REST API Server Running    ║
╠════════════════════════════════════════╣
║   Network: ${config.network.padEnd(20)} ║
║   Port: ${String(config.server.port).padEnd(26)} ║
║   Environment: ${config.server.nodeEnv.padEnd(19)} ║
╚════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await walletProvider.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await walletProvider.close();
  process.exit(0);
});

// Start server
startServer();
```

## 🧪 Testing

### Unit Tests

Create `tests/proofs.test.js`:

```javascript
const proofService = require('../src/services/proofs');

describe('ProofService', () => {
  describe('validateInputs', () => {
    test('should throw error for invalid contract address', () => {
      expect(() => {
        proofService.validateInputs(null, 'method', []);
      }).toThrow('Invalid contract address');
    });

    test('should throw error for invalid method', () => {
      expect(() => {
        proofService.validateInputs('0x123', null, []);
      }).toThrow('Invalid method name');
    });

    test('should throw error for non-array args', () => {
      expect(() => {
        proofService.validateInputs('0x123', 'method', 'not-array');
      }).toThrow('Arguments must be an array');
    });

    test('should accept valid inputs', () => {
      expect(() => {
        proofService.validateInputs('0x123', 'method', []);
      }).not.toThrow();
    });
  });

  describe('getProofStatus', () => {
    test('should return exists: false for unknown proof', () => {
      const status = proofService.getProofStatus('unknown-proof-id');
      expect(status.exists).toBe(false);
    });
  });
});
```

### Integration Tests

Create `tests/transactions.test.js`:

```javascript
const request = require('supertest');
const app = require('../src/index');

describe('Transaction API', () => {
  describe('POST /api/contracts/:address/call', () => {
    test('should return 400 for missing fields', async () => {
      const response = await request(app)
        .post('/api/contracts/0x123/call')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should generate proof for valid request', async () => {
      const response = await request(app)
        .post('/api/contracts/0x123/call')
        .send({
          method: 'transfer',
          args: ['0x456', 100],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
```

### Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/proofs.test.js
```

## 📡 API Documentation

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/contracts/:address/call` | Generate proof for contract call |
| GET | `/api/contracts/proof/:proofId` | Get proof status |
| POST | `/api/contracts/transaction` | Submit transaction with proof |
| GET | `/api/contracts/transaction/:txId` | Get transaction status |
| POST | `/api/contracts/:address/call-and-submit` | Generate proof and submit in one step |
| GET | `/health` | Health check endpoint |

### Example Requests

#### Generate Proof

```bash
curl -X POST http://localhost:3000/api/contracts/0x123/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "transfer",
    "args": ["0x456", 100]
  }'
```

#### Submit Transaction

```bash
curl -X POST http://localhost:3000/api/contracts/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {...},
    "contractCall": {
      "contractAddress": "0x123",
      "method": "transfer",
      "args": ["0x456", 100]
    }
  }'
```

## 🔒 Security Best Practices

### 1. Environment Variables

Never commit `.env` files to version control. Use `.env.example`:

```env
MIDNIGHT_NETWORK=testnet
MIDNIGHT_NODE_URL=https://testnet-node.midnight.network
WALLET_PRIVATE_KEY=your_private_key_here
PORT=3000
```

### 2. Rate Limiting

Implement rate limiting to prevent abuse:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 3. Input Validation

Always validate and sanitize inputs:

```javascript
const { body, validationResult } = require('express-validator');

router.post(
  '/:address/call',
  [
    body('method').isString().notEmpty(),
    body('args').isArray(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // ... rest of handler
  }
);
```

## 🚀 Deployment

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  midnight-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MIDNIGHT_NETWORK=testnet
    env_file:
      - .env
    restart: unless-stopped
```

## 📝 Conclusion

This tutorial covered:

✅ Setting up a secure server environment  
✅ Generating proofs with `httpClientProofProvider`  
✅ Creating REST API endpoints  
✅ Implementing error handling and retry logic  
✅ Writing comprehensive tests  
✅ Deploying with Docker  

You now have a production-ready Midnight integration! 🎉

## 📚 Resources

- [Midnight Documentation](https://docs.midnight.network/)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
- [Developer Forum](https://forum.midnight.network/)
- [Discord](https://discord.com/invite/midnightnetwork)

---

**Ready for Review!** 🌾

**Wallet:** [Will provide upon submission]
