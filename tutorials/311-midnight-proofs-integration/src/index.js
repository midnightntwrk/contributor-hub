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
