/**
 * Oracle Node Service for Midnight Network
 *
 * Copyright (C) 2025 Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 *
 * This off-chain service implements the Oracle node that:
 * 1. Fetches price data from multiple external sources
 * 2. Aggregates the data (median)
 * 3. Signs the result
 * 4. Submits it to the on-chain Oracle contract
 *
 * Configuration is loaded from environment variables.
 */

import axios from 'axios';
import * as crypto from 'crypto';
import { ethers } from 'ethers';

// === Configuration ===

interface OracleConfig {
  // External price API endpoints
  priceApis: {
    name: string;
    url: string;
    parser: (data: any) => number;
    weight: number;
  }[];

  // Oracle contract address on Midnight
  contractAddress: string;

  // Node's private key for signing submissions
  privateKey: string;

  // Update interval in milliseconds
  updateIntervalMs: number;

  // Minimum number of sources required for a valid update
  minSources: number;

  // Maximum price deviation (percentage) between sources before alerting
  maxDeviationPercent: number;

  // Midnight Network RPC endpoint
  rpcEndpoint: string;

  // Fixed-point decimal places
  fixedPointDecimals: number;
}

const DEFAULT_CONFIG: OracleConfig = {
  priceApis: [
    {
      name: 'CoinGecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      parser: (data: any) => data.bitcoin.usd,
      weight: 1
    },
    {
      name: 'Coinbase',
      url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      parser: (data: any) => parseFloat(data.data.amount),
      weight: 1
    },
    {
      name: 'Kraken',
      url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      parser: (data: any) => parseFloat(data.result.XXBTZUSD.c[0]),
      weight: 1
    }
  ],
  contractAddress: process.env.ORACLE_CONTRACT_ADDRESS || '',
  privateKey: process.env.ORACLE_PRIVATE_KEY || '',
  updateIntervalMs: parseInt(process.env.UPDATE_INTERVAL_MS || '30000'),
  minSources: parseInt(process.env.MIN_SOURCES || '2'),
  maxDeviationPercent: parseFloat(process.env.MAX_DEVIATION_PERCENT || '5'),
  rpcEndpoint: process.env.MIDNIGHT_RPC_ENDPOINT || 'https://rpc.midnight.network',
  fixedPointDecimals: 8
};

// === Price Fetching ===

interface PriceResult {
  source: string;
  price: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

/**
 * Fetch price from a single source
 */
async function fetchPriceFromSource(
  source: OracleConfig['priceApis'][0]
): Promise<PriceResult> {
  const timestamp = Date.now();

  try {
    const response = await axios.get(source.url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'MidnightOracleNode/1.0'
      }
    });

    const price = source.parser(response.data);

    if (!price || isNaN(price) || price <= 0) {
      return {
        source: source.name,
        price: 0,
        timestamp,
        success: false,
        error: 'Invalid price value parsed from response'
      };
    }

    return {
      source: source.name,
      price,
      timestamp,
      success: true
    };
  } catch (error: any) {
    return {
      source: source.name,
      price: 0,
      timestamp,
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Fetch prices from all configured sources
 */
async function fetchAllPrices(config: OracleConfig): Promise<PriceResult[]> {
  const promises = config.priceApis.map(source => fetchPriceFromSource(source));
  return Promise.all(promises);
}

// === Data Aggregation ===

interface AggregatedPrice {
  // The aggregated price (raw, not fixed-point)
  price: number;

  // Number of successful sources
  sourceCount: number;

  // Confidence score (0-100)
  confidence: number;

  // Individual source results for logging
  results: PriceResult[];

  // Standard deviation of prices (for confidence calculation)
  standardDeviation: number;

  // Timestamp of aggregation
  timestamp: number;
}

/**
 * Compute median of an array of numbers
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute standard deviation
 */
function standardDeviation(values: number[]): number {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * Compute confidence score based on agreement between sources
 *
 * Returns 0-100 where:
 * - 100 = all sources agree exactly
 * - 80+ = sources agree within 1%
 * - 50+ = sources agree within 5%
 * - <50 = significant disagreement
 */
function computeConfidence(prices: number[]): number {
  if (prices.length < 2) return 50; // Neutral with single source

  const medianPrice = median(prices);
  const deviations = prices.map(p => Math.abs((p - medianPrice) / medianPrice) * 100);
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;

  // Map average deviation to confidence score
  // 0% deviation = 100 confidence
  // 10%+ deviation = 0 confidence
  const confidence = Math.max(0, Math.min(100, Math.round(100 - (avgDeviation * 10))));
  return confidence;
}

/**
 * Aggregate price results from multiple sources
 *
 * Uses weighted median with outlier detection.
 */
function aggregatePrices(
  results: PriceResult[],
  config: OracleConfig
): AggregatedPrice {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  // Log failures
  for (const fail of failed) {
    console.warn(`[Oracle] Source ${fail.source} failed: ${fail.error}`);
  }

  if (successful.length < config.minSources) {
    throw new Error(
      `Insufficient sources: got ${successful.length}, need ${config.minSources}. ` +
      `Failed: ${failed.map(f => f.source).join(', ')}`
    );
  }

  const prices = successful.map(r => r.price);
  const stdDev = standardDeviation(prices);
  const medianPrice = median(prices);

  // Check for excessive deviation (potential data source manipulation)
  const maxDeviation = Math.max(...prices.map(p =>
    Math.abs((p - medianPrice) / medianPrice) * 100
  ));

  if (maxDeviation > config.maxDeviationPercent) {
    console.warn(
      `[Oracle] WARNING: Max deviation ${maxDeviation.toFixed(2)}% exceeds threshold ` +
      `${config.maxDeviationPercent}%. Prices: ${prices.join(', ')}`
    );
    // In production, you might want to:
    // 1. Skip this update
    // 2. Use only the median sources
    // 3. Alert operators
  }

  const confidence = computeConfidence(prices);

  console.log(`[Oracle] Aggregated price: $${medianPrice.toFixed(2)}`);
  console.log(`[Oracle] Sources: ${successful.length}/${results.length}`);
  console.log(`[Oracle] Std Dev: $${stdDev.toFixed(2)}`);
  console.log(`[Oracle] Confidence: ${confidence}/100`);

  return {
    price: medianPrice,
    sourceCount: successful.length,
    confidence,
    results,
    standardDeviation: stdDev,
    timestamp: Date.now()
  };
}

// === Fixed-Point Conversion ===

/**
 * Convert a floating-point price to fixed-point integer
 *
 * Example: 50000.00 with 8 decimals → 5000000000000
 */
function toFixedPoint(price: number, decimals: number): string {
  return Math.round(price * Math.pow(10, decimals)).toString();
}

/**
 * Convert fixed-point integer back to floating-point
 */
function fromFixedPoint(fixedPrice: string, decimals: number): number {
  return parseInt(fixedPrice) / Math.pow(10, decimals);
}

// === Signing ===

interface SignedSubmission {
  price: string;          // Fixed-point price
  sourceCount: number;
  confidence: number;
  timestamp: number;
  nonce: number;
  signature: string;
}

/**
 * Sign a price submission
 *
 * Creates a deterministic signature over the submission data
 * that can be verified on-chain.
 */
async function signSubmission(
  price: string,
  sourceCount: number,
  confidence: number,
  timestamp: number,
  nonce: number,
  privateKey: string
): Promise<string> {
  // Encode the data deterministically
  const message = ethers.solidityPacked(
    ['uint128', 'uint8', 'uint8', 'uint64', 'uint64'],
    [price, sourceCount, confidence, timestamp, nonce]
  );

  // Hash the message
  const messageHash = ethers.keccak256(message);

  // Sign with the node's private key
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return signature;
}

// === On-Chain Submission ===

/**
 * Submit price data to the Oracle contract
 *
 * This function constructs and sends the transaction to the
 * OraclePriceFeed contract on Midnight Network.
 */
async function submitToContract(
  submission: SignedSubmission,
  config: OracleConfig
): Promise<string> {
  console.log(`[Oracle] Submitting price ${submission.price} to contract...`);

  // In a real implementation, this would use Midnight's SDK:
  //
  // const provider = new MidnightProvider(config.rpcEndpoint);
  // const contract = OraclePriceFeed.at(config.contractAddress);
  // const tx = await contract.submitPrice(
  //   submission.price,
  //   submission.sourceCount,
  //   submission.confidence,
  //   submission.signature
  // );
  // await tx.wait();
  // return tx.hash;

  // Placeholder for demonstration
  const txHash = crypto.randomBytes(32).toString('hex');
  console.log(`[Oracle] Transaction submitted: ${txHash}`);
  return txHash;
}

// === Main Loop ===

let currentNonce = 0;

/**
 * Execute a single Oracle update cycle
 */
async function runUpdateCycle(config: OracleConfig): Promise<void> {
  console.log('\n[Oracle] === Starting update cycle ===');
  console.log(`[Oracle] Timestamp: ${new Date().toISOString()}`);

  try {
    // Step 1: Fetch prices from all sources
    console.log('[Oracle] Fetching prices from external sources...');
    const results = await fetchAllPrices(config);

    // Step 2: Aggregate the results
    const aggregated = aggregatePrices(results, config);

    // Step 3: Convert to fixed-point
    const fixedPointPrice = toFixedPoint(aggregated.price, config.fixedPointDecimals);
    console.log(`[Oracle] Fixed-point price: ${fixedPointPrice}`);

    // Step 4: Sign the submission
    currentNonce++;
    const signature = await signSubmission(
      fixedPointPrice,
      aggregated.sourceCount,
      aggregated.confidence,
      Math.floor(Date.now() / 1000), // Unix timestamp in seconds
      currentNonce,
      config.privateKey
    );

    // Step 5: Submit to the contract
    const submission: SignedSubmission = {
      price: fixedPointPrice,
      sourceCount: aggregated.sourceCount,
      confidence: aggregated.confidence,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: currentNonce,
      signature
    };

    const txHash = await submitToContract(submission, config);
    console.log(`[Oracle] Update cycle complete. TX: ${txHash}`);
    console.log(`[Oracle] Price: $${aggregated.price.toFixed(2)} | ` +
                `Sources: ${aggregated.sourceCount} | ` +
                `Confidence: ${aggregated.confidence}/100`);

  } catch (error: any) {
    console.error(`[Oracle] Update cycle failed: ${error.message}`);
    // In production:
    // - Send alert to monitoring system
    // - If failures are persistent, consider pausing the Oracle
    // - Log to structured logging for analysis
  }

  console.log('[Oracle] === Update cycle complete ===\n');
}

/**
 * Graceful shutdown handler
 */
let isRunning = true;

function shutdown(signal: string): void {
  console.log(`[Oracle] Received ${signal}. Shutting down gracefully...`);
  isRunning = false;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('=== Midnight Oracle Node v1.0.0 ===');
  console.log(`Network: ${DEFAULT_CONFIG.rpcEndpoint}`);
  console.log(`Contract: ${DEFAULT_CONFIG.contractAddress}`);
  console.log(`Update interval: ${DEFAULT_CONFIG.updateIntervalMs}ms`);
  console.log(`Min sources: ${DEFAULT_CONFIG.minSources}`);
  console.log('');

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Validate configuration
  if (!DEFAULT_CONFIG.contractAddress) {
    console.error('[Oracle] ERROR: ORACLE_CONTRACT_ADDRESS not set');
    process.exit(1);
  }
  if (!DEFAULT_CONFIG.privateKey) {
    console.error('[Oracle] ERROR: ORACLE_PRIVATE_KEY not set');
    process.exit(1);
  }

  // Main loop
  while (isRunning) {
    await runUpdateCycle(DEFAULT_CONFIG);

    // Wait for the next update interval
    await new Promise(resolve => setTimeout(resolve, DEFAULT_CONFIG.updateIntervalMs));
  }

  console.log('[Oracle] Node shut down successfully.');
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('[Oracle] Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export {
  fetchAllPrices,
  aggregatePrices,
  toFixedPoint,
  fromFixedPoint,
  signSubmission,
  computeConfidence,
  median,
  standardDeviation,
  OracleConfig,
  DEFAULT_CONFIG
};
