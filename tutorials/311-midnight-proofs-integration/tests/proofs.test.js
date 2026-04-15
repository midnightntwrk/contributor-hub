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

  describe('handleError', () => {
    test('should categorize timeout errors as retryable', () => {
      const error = new Error('Request timeout');
      const handled = proofService.handleError(error);
      expect(handled.type).toBe('PROOF_TIMEOUT');
      expect(handled.retryable).toBe(true);
    });

    test('should categorize network errors as retryable', () => {
      const error = new Error('Network error');
      const handled = proofService.handleError(error);
      expect(handled.type).toBe('NETWORK_ERROR');
      expect(handled.retryable).toBe(true);
    });

    test('should categorize invalid input errors as non-retryable', () => {
      const error = new Error('Invalid input');
      const handled = proofService.handleError(error);
      expect(handled.type).toBe('INVALID_INPUT');
      expect(handled.retryable).toBe(false);
    });
  });
});
