/**
 * test-harness.ts
 * 
 * Comprehensive test suite for the CommitRevealVoting contract.
 * Tests all phases, edge cases, and security properties.
 * 
 * Usage:
 *   npm test
 * 
 * Requires:
 *   - @midnight-ntwrk/compact-test-utils
 *   - @midnight-ntwrk/compact-runtime
 *   - vitest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContract, TestWallet } from '@midnight-ntwrk/compact-test-utils';
import { poseidon } from '@midnight-ntwrk/compact-runtime';

// Helper: compute a commitment hash off-chain
function computeCommitment(
    voterAddress: Uint8Array,
    voteChoice: number,
    salt: bigint
): bigint {
    return poseidon([
        BigInt('0x' + Buffer.from(voterAddress).toString('hex')),
        BigInt(voteChoice),
        salt
    ]);
}

// Helper: generate a random salt with sufficient entropy
function generateSalt(): bigint {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

describe('CommitRevealVoting', () => {
    let contract: any;
    let admin: TestWallet;
    let voter1: TestWallet;
    let voter2: TestWallet;
    let voter3: TestWallet;
    let voter4: TestWallet;

    beforeEach(async () => {
        contract = await createTestContract('CommitRevealVoting');
        admin = contract.createWallet('admin');
        voter1 = contract.createWallet('voter1');
        voter2 = contract.createWallet('voter2');
        voter3 = contract.createWallet('voter3');
        voter4 = contract.createWallet('voter4');
    });

    afterEach(async () => {
        await contract.cleanup();
    });

    // ──────────────────────────────────────────────
    // Full Lifecycle Tests
    // ──────────────────────────────────────────────

    describe('Full Voting Lifecycle', () => {
        it('should complete a full 3-option vote with partial reveal', async () => {
            // Create proposal: "Should we upgrade?"
            await admin.call('createProposal', [
                'Should we upgrade the protocol?',
                ['Yes', 'No', 'Abstain'],
                3,
                100,   // 100 blocks for commit phase
                100    // 100 blocks for reveal phase
            ]);

            // Verify initial state
            const initialState = await admin.call('getState');
            expect(initialState).toBe('CommitOpen');

            // Voters prepare commitments off-chain
            const salt1 = generateSalt();
            const salt2 = generateSalt();
            const salt3 = generateSalt();

            const commitment1 = computeCommitment(voter1.address, 0, salt1); // Yes
            const commitment2 = computeCommitment(voter2.address, 1, salt2); // No
            const commitment3 = computeCommitment(voter3.address, 0, salt3); // Yes

            // Commit phase: all three voters submit commitments
            await voter1.call('commit', [commitment1]);
            await voter2.call('commit', [commitment2]);
            await voter3.call('commit', [commitment3]);

            // Verify participation
            const [committed, revealed] = await admin.call('getParticipation');
            expect(committed).toBe(3n);
            expect(revealed).toBe(0n);

            // Advance past commit deadline
            await contract.advanceBlocks(101);

            // Admin opens reveal phase
            await admin.call('openRevealPhase');
            const revealState = await admin.call('getState');
            expect(revealState).toBe('RevealOpen');

            // Reveal phase: voter1 and voter2 reveal, voter3 forgets
            await voter1.call('reveal', [0, salt1]); // Yes
            await voter2.call('reveal', [1, salt2]); // No
            // voter3 does NOT reveal (simulating lost salt)

            // Advance past reveal deadline
            await contract.advanceBlocks(101);

            // Admin closes proposal
            const results = await admin.call('closeProposal');
            expect(results[0]).toBe(2n);  // 2 Yes votes
            expect(results[1]).toBe(1n);  // 1 No vote
            expect(results[2]).toBe(0n);  // 0 Abstain (voter3 didn't reveal)

            // Final state
            const finalState = await admin.call('getState');
            expect(finalState).toBe('Closed');

            // Final participation
            const [finalCommitted, finalRevealed] = await admin.call('getParticipation');
            expect(finalCommitted).toBe(3n);
            expect(finalRevealed).toBe(2n);
        });

        it('should handle unanimous vote', async () => {
            await admin.call('createProposal', ['Unanimous?', ['Yes', 'No'], 2, 50, 50]);

            const salts = [generateSalt(), generateSalt(), generateSalt()];
            const voters = [voter1, voter2, voter3];

            // Everyone votes Yes (option 0)
            for (let i = 0; i < 3; i++) {
                const commitment = computeCommitment(voters[i].address, 0, salts[i]);
                await voters[i].call('commit', [commitment]);
            }

            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');

            for (let i = 0; i < 3; i++) {
                await voters[i].call('reveal', [0, salts[i]]);
            }

            await contract.advanceBlocks(51);
            const results = await admin.call('closeProposal');
            expect(results[0]).toBe(3n);  // 3 Yes
            expect(results[1]).toBe(0n);  // 0 No
        });
    });

    // ──────────────────────────────────────────────
    // Security Tests
    // ──────────────────────────────────────────────

    describe('Security: Double-Commit Prevention', () => {
        it('should reject double commits from the same voter', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await voter1.call('commit', [commitment]);

            // Second commit should fail
            await expect(
                voter1.call('commit', [commitment])
            ).rejects.toThrow('Voter has already committed');
        });

        it('should reject commits with duplicate commitment hashes', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await voter1.call('commit', [commitment]);

            // Different voter with same commitment hash should fail
            // (extremely unlikely in practice, but test the defense)
            await expect(
                voter2.call('commit', [commitment])
            ).rejects.toThrow('Commitment already exists');
        });
    });

    describe('Security: Mismatched Reveal', () => {
        it('should reject reveal with wrong vote choice', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt); // Voted A

            await voter1.call('commit', [commitment]);
            await contract.advanceBlocks(101);
            await admin.call('openRevealPhase');

            // Try to reveal as B (option 1) — should fail
            await expect(
                voter1.call('reveal', [1, salt])
            ).rejects.toThrow('No matching commitment found');
        });

        it('should reject reveal with wrong salt', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await voter1.call('commit', [commitment]);
            await contract.advanceBlocks(101);
            await admin.call('openRevealPhase');

            // Try to reveal with a different salt — should fail
            const wrongSalt = generateSalt();
            await expect(
                voter1.call('reveal', [0, wrongSalt])
            ).rejects.toThrow('No matching commitment found');
        });
    });

    describe('Security: Double-Reveal Prevention', () => {
        it('should reject double reveals', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await voter1.call('commit', [commitment]);
            await contract.advanceBlocks(101);
            await admin.call('openRevealPhase');

            await voter1.call('reveal', [0, salt]);

            // Second reveal should fail
            await expect(
                voter1.call('reveal', [0, salt])
            ).rejects.toThrow('Vote has already been revealed');
        });
    });

    // ──────────────────────────────────────────────
    // Phase Enforcement Tests
    // ──────────────────────────────────────────────

    describe('Phase Enforcement', () => {
        it('should reject commits during reveal phase', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 50, 50]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');

            await expect(
                voter1.call('commit', [commitment])
            ).rejects.toThrow('Commit phase is not open');
        });

        it('should reject reveals during commit phase', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();

            await expect(
                voter1.call('reveal', [0, salt])
            ).rejects.toThrow('Reveal phase is not open');
        });

        it('should reject commits after deadline', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 50, 50]);

            await contract.advanceBlocks(51); // Past commit deadline

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt);

            await expect(
                voter1.call('commit', [commitment])
            ).rejects.toThrow('Commit phase has ended');
        });

        it('should reject early reveal phase transition', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            // Try to open reveal before commit deadline
            await expect(
                admin.call('openRevealPhase')
            ).rejects.toThrow('Commit deadline not yet reached');
        });

        it('should reject non-admin reveal phase transition', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 50, 50]);

            await contract.advanceBlocks(51);

            await expect(
                voter1.call('openRevealPhase')
            ).rejects.toThrow('Only admin can transition phases');
        });

        it('should reject close before reveal deadline', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 50, 50]);

            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');

            // Try to close immediately (reveal deadline not reached)
            await expect(
                admin.call('closeProposal')
            ).rejects.toThrow('Reveal deadline not yet reached');
        });

        it('should reject out-of-range vote choice', async () => {
            await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);

            const salt = generateSalt();
            // Vote for option 5 (only 2 options exist)
            const commitment = computeCommitment(voter1.address, 5, salt);

            await voter1.call('commit', [commitment]);
            await contract.advanceBlocks(101);
            await admin.call('openRevealPhase');

            await expect(
                voter1.call('reveal', [5, salt])
            ).rejects.toThrow('Invalid vote choice');
        });
    });

    // ──────────────────────────────────────────────
    // Quorum Tests
    // ──────────────────────────────────────────────

    describe('Quorum Enforcement', () => {
        it('should report quorum met when sufficient votes revealed', async () => {
            await admin.call('createProposal', ['Quorum Test', ['Yes', 'No'], 2, 50, 50]);

            const salts = [generateSalt(), generateSalt()];
            const voters = [voter1, voter2];

            for (let i = 0; i < 2; i++) {
                const commitment = computeCommitment(voters[i].address, 0, salts[i]);
                await voters[i].call('commit', [commitment]);
            }

            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');

            for (let i = 0; i < 2; i++) {
                await voters[i].call('reveal', [0, salts[i]]);
            }

            await contract.advanceBlocks(51);

            // Quorum of 2, both revealed
            const [results, quorumMet] = await admin.call('closeProposalWithQuorum', [2]);
            expect(quorumMet).toBe(true);
            expect(results[0]).toBe(2n);
        });

        it('should report quorum not met when insufficient votes revealed', async () => {
            await admin.call('createProposal', ['Quorum Test', ['Yes', 'No'], 2, 50, 50]);

            const salt1 = generateSalt();
            const commitment = computeCommitment(voter1.address, 0, salt1);
            await voter1.call('commit', [commitment]);

            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');
            await voter1.call('reveal', [0, salt1]);

            await contract.advanceBlocks(51);

            // Quorum of 5, but only 1 revealed
            const [results, quorumMet] = await admin.call('closeProposalWithQuorum', [5]);
            expect(quorumMet).toBe(false);
        });
    });

    // ──────────────────────────────────────────────
    // Edge Case Tests
    // ──────────────────────────────────────────────

    describe('Edge Cases', () => {
        it('should handle proposal with zero reveals', async () => {
            await admin.call('createProposal', ['No Show', ['A', 'B'], 2, 50, 50]);

            // No one commits
            await contract.advanceBlocks(51);
            await admin.call('openRevealPhase');
            await contract.advanceBlocks(51);

            const results = await admin.call('closeProposal');
            expect(results[0]).toBe(0n);
            expect(results[1]).toBe(0n);
        });

        it('should handle maximum options (16)', async () => {
            const options = Array.from({ length: 16 }, (_, i) => `Option ${i}`);
            await admin.call('createProposal', ['Many Options', options, 16, 100, 100]);

            const salt = generateSalt();
            const commitment = computeCommitment(voter1.address, 15, salt); // Last option

            await voter1.call('commit', [commitment]);
            await contract.advanceBlocks(101);
            await admin.call('openRevealPhase');
            await voter1.call('reveal', [15, salt]);

            await contract.advanceBlocks(101);
            const results = await admin.call('closeProposal');
            expect(results[15]).toBe(1n);
        });
    });
});
