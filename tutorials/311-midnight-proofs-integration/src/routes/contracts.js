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
