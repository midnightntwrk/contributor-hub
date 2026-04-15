const request = require('supertest');
const express = require('express');
const contractRoutes = require('../src/routes/contracts');

// Mock services
jest.mock('../src/services/proofs');
jest.mock('../src/services/transactions');

const app = express();
app.use(express.json());
app.use('/api/contracts', contractRoutes);

describe('Transaction API', () => {
  describe('POST /api/contracts/:address/call', () => {
    test('should return 400 for missing fields', async () => {
      const response = await request(app)
        .post('/api/contracts/0x123/call')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return 400 for missing method', async () => {
      const response = await request(app)
        .post('/api/contracts/0x123/call')
        .send({ args: [] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return 400 for missing args', async () => {
      const response = await request(app)
        .post('/api/contracts/0x123/call')
        .send({ method: 'transfer' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/contracts/proof/:proofId', () => {
    test('should return 404 for unknown proof', async () => {
      const response = await request(app)
        .get('/api/contracts/proof/unknown-id');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/contracts/transaction', () => {
    test('should return 400 for missing proof', async () => {
      const response = await request(app)
        .post('/api/contracts/transaction')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return 400 for missing contractCall', async () => {
      const response = await request(app)
        .post('/api/contracts/transaction')
        .send({ proof: {} });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /health', () => {
    test('should return healthy status', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });
  });
});
