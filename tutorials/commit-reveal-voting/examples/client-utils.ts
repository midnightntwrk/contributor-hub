/**
 * client-utils.ts
 * 
 * Client-side utility functions for interacting with the CommitRevealVoting contract.
 * Provides helpers for commitment generation, vote management, and contract interaction.
 * 
 * Usage:
 *   import { VoteManager } from './client-utils';
 *   const manager = new VoteManager(contractAddress, wallet);
 *   await manager.castVote(0); // Vote for option 0
 *   await manager.revealVote(); // Reveal after commit phase ends
 */

import { poseidon } from '@midnight-ntwrk/compact-runtime';
import { CompactClient, Wallet } from '@midnight-ntwrk/dapp-connector';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface VoteCommitment {
    commitmentHash: bigint;
    voteChoice: number;
    salt: bigint;
    timestamp: number;
}

interface VoteStatus {
    hasCommitted: boolean;
    hasRevealed: boolean;
    commitmentHash: bigint | null;
}

interface ProposalInfo {
    title: string;
    options: string[];
    optionCount: number;
    state: string;
    totalCommitted: number;
    totalRevealed: number;
}

// ──────────────────────────────────────────────
// Salt Management
// ──────────────────────────────────────────────

/**
 * Generate a cryptographically secure random salt.
 * Uses 128 bits of entropy for brute-force resistance.
 */
export function generateSalt(): bigint {
    const bytes = new Uint8Array(16); // 128 bits
    crypto.getRandomValues(bytes);
    return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

/**
 * Store a vote commitment securely in local storage.
 * WARNING: If this data is lost, the vote cannot be revealed!
 */
function storeCommitment(contractAddress: string, commitment: VoteCommitment): void {
    const key = `commit-reveal-vote-${contractAddress}`;
    const data = JSON.stringify({
        commitmentHash: commitment.commitmentHash.toString(),
        voteChoice: commitment.voteChoice,
        salt: commitment.salt.toString(),
        timestamp: commitment.timestamp
    });
    localStorage.setItem(key, data);
}

/**
 * Retrieve a stored vote commitment from local storage.
 */
function retrieveCommitment(contractAddress: string): VoteCommitment | null {
    const key = `commit-reveal-vote-${contractAddress}`;
    const data = localStorage.getItem(key);
    if (!data) return null;

    const parsed = JSON.parse(data);
    return {
        commitmentHash: BigInt(parsed.commitmentHash),
        voteChoice: parsed.voteChoice,
        salt: BigInt(parsed.salt),
        timestamp: parsed.timestamp
    };
}

// ──────────────────────────────────────────────
// Commitment Computation
// ──────────────────────────────────────────────

/**
 * Compute a Poseidon commitment hash for a vote.
 * 
 * @param voterAddress - The voter's address as a byte array
 * @param voteChoice - The chosen option index (0-based)
 * @param salt - A random secret value
 * @returns The Poseidon hash commitment (a field element)
 */
export function computeCommitment(
    voterAddress: Uint8Array,
    voteChoice: number,
    salt: bigint
): bigint {
    // Convert voter address to a field element
    const addressField = BigInt('0x' + Buffer.from(voterAddress).toString('hex'));

    // Compute Poseidon hash over (address, choice, salt)
    return poseidon([addressField, BigInt(voteChoice), salt]);
}

// ──────────────────────────────────────────────
// Vote Manager Class
// ──────────────────────────────────────────────

/**
 * High-level manager for interacting with the CommitRevealVoting contract.
 * Handles the full lifecycle: commit, store secrets, reveal, and query.
 */
export class VoteManager {
    private client: CompactClient;
    private wallet: Wallet;
    private contractAddress: string;
    private currentCommitment: VoteCommitment | null;

    constructor(contractAddress: string, wallet: Wallet) {
        this.contractAddress = contractAddress;
        this.wallet = wallet;
        this.client = new CompactClient(contractAddress, wallet);
        this.currentCommitment = retrieveCommitment(contractAddress);
    }

    /**
     * Cast a vote by submitting a commitment to the contract.
     * The vote choice and salt are stored locally for later reveal.
     * 
     * @param voteChoice - The option index to vote for
     * @returns The commitment hash that was submitted
     * @throws If the commit phase is not open or the voter has already committed
     */
    async castVote(voteChoice: number): Promise<bigint> {
        // Generate a secure random salt
        const salt = generateSalt();

        // Get voter address
        const address = await this.wallet.getAddress();

        // Compute commitment
        const commitmentHash = computeCommitment(
            new Uint8Array(address),
            voteChoice,
            salt
        );

        // Submit commitment to the contract
        await this.client.call('commit', [commitmentHash]);

        // Store the commitment data locally (critical for reveal!)
        const commitment: VoteCommitment = {
            commitmentHash,
            voteChoice,
            salt,
            timestamp: Date.now()
        };
        storeCommitment(this.contractAddress, commitment);
        this.currentCommitment = commitment;

        console.log(`Vote committed. Choice: ${voteChoice}, Hash: ${commitmentHash}`);
        console.log('⚠️  IMPORTANT: Your salt is stored in localStorage.');
        console.log('    If you clear browser data, your vote cannot be revealed!');

        return commitmentHash;
    }

    /**
     * Reveal a previously committed vote.
     * Uses the stored commitment data to verify the reveal.
     * 
     * @throws If no commitment is found or the reveal fails
     */
    async revealVote(): Promise<void> {
        if (!this.currentCommitment) {
            throw new Error(
                'No vote commitment found. Did you clear browser data? ' +
                'If so, your vote cannot be revealed.'
            );
        }

        // Submit reveal to the contract
        // The contract will recompute the Poseidon hash and verify it matches
        await this.client.call('reveal', [
            this.currentCommitment.voteChoice,
            this.currentCommitment.salt
        ]);

        console.log(
            `Vote revealed! Choice: ${this.currentCommitment.voteChoice}`
        );
    }

    /**
     * Check the current status of this voter's participation.
     * 
     * @returns VoteStatus indicating whether the voter has committed and/or revealed
     */
    async getStatus(): Promise<VoteStatus> {
        return {
            hasCommitted: this.currentCommitment !== null,
            hasRevealed: false, // Would need to query on-chain state
            commitmentHash: this.currentCommitment?.commitmentHash ?? null
        };
    }

    /**
     * Get information about the current proposal.
     * 
     * @returns ProposalInfo with title, options, state, and participation
     */
    async getProposalInfo(): Promise<ProposalInfo> {
        const state = await this.client.call('getState');
        const [totalCommitted, totalRevealed] = await this.client.call('getParticipation');

        return {
            title: 'Current Proposal', // Would need to decode from contract
            options: [], // Would need to decode from contract
            optionCount: 0,
            state: String(state),
            totalCommitted: Number(totalCommitted),
            totalRevealed: Number(totalRevealed)
        };
    }

    /**
     * Get the final vote tally (only available after proposal is closed).
     * 
     * @returns Array of vote counts per option
     */
    async getResults(): Promise<bigint[]> {
        const results = await this.client.call('getResults');
        return Array.from(results);
    }

    /**
     * Check if the voter has a stored commitment.
     * Useful for UI state management.
     */
    hasStoredCommitment(): boolean {
        return this.currentCommitment !== null;
    }

    /**
     * Export the commitment data for backup purposes.
     * The voter should save this in a secure location.
     */
    exportCommitment(): string | null {
        if (!this.currentCommitment) return null;
        return JSON.stringify({
            commitmentHash: this.currentCommitment.commitmentHash.toString(),
            voteChoice: this.currentCommitment.voteChoice,
            salt: this.currentCommitment.salt.toString(),
            contractAddress: this.contractAddress
        }, null, 2);
    }

    /**
     * Import a previously exported commitment.
     * Useful if the voter needs to reveal on a different device.
     */
    importCommitment(jsonData: string): void {
        const parsed = JSON.parse(jsonData);
        if (parsed.contractAddress !== this.contractAddress) {
            throw new Error('Commitment is for a different contract');
        }

        this.currentCommitment = {
            commitmentHash: BigInt(parsed.commitmentHash),
            voteChoice: parsed.voteChoice,
            salt: BigInt(parsed.salt),
            timestamp: Date.now()
        };
        storeCommitment(this.contractAddress, this.currentCommitment);
    }
}

// ──────────────────────────────────────────────
// Admin Utilities
// ──────────────────────────────────────────────

/**
 * Admin helper for managing the voting lifecycle.
 */
export class VotingAdmin {
    private client: CompactClient;
    private wallet: Wallet;

    constructor(contractAddress: string, wallet: Wallet) {
        this.wallet = wallet;
        this.client = new CompactClient(contractAddress, wallet);
    }

    /**
     * Create a new proposal.
     */
    async createProposal(
        title: string,
        options: string[],
        commitDurationBlocks: number,
        revealDurationBlocks: number
    ): Promise<void> {
        // Encode title to bytes (max 64 bytes)
        const titleBytes = new TextEncoder().encode(title.padEnd(64, '\0')).slice(0, 64);

        // Encode options to bytes (max 32 bytes each, up to 16 options)
        const optionBytes = options.map(opt => {
            const encoded = new TextEncoder().encode(opt.padEnd(32, '\0')).slice(0, 32);
            return encoded;
        });

        await this.client.call('createProposal', [
            titleBytes,
            optionBytes,
            options.length,
            commitDurationBlocks,
            revealDurationBlocks
        ]);

        console.log(`Proposal created: "${title}" with ${options.length} options`);
    }

    /**
     * Transition from commit phase to reveal phase.
     */
    async openRevealPhase(): Promise<void> {
        await this.client.call('openRevealPhase');
        console.log('Reveal phase opened');
    }

    /**
     * Close the proposal and get final results.
     */
    async closeProposal(): Promise<bigint[]> {
        const results = await this.client.call('closeProposal');
        console.log('Proposal closed');
        return Array.from(results);
    }

    /**
     * Close with quorum check.
     */
    async closeWithQuorum(minimumVotes: number): Promise<{ results: bigint[]; quorumMet: boolean }> {
        const [results, quorumMet] = await this.client.call('closeProposalWithQuorum', [minimumVotes]);
        return {
            results: Array.from(results),
            quorumMet: Boolean(quorumMet)
        };
    }
}
