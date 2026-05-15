// Merkle Proof Verifier in Circom 2.x
// Demonstrates the traditional Circom approach to ZK Merkle verification
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

template MerkleProofVerifier(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;

    component hashers[depth];
    component mux[depth];

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // Enforce binary constraint on path indices
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select left/right child based on path index
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== hashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== hashes[i];
        mux[i].s <== pathIndices[i];

        // Hash the pair
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        hashes[i + 1] <== hashers[i].out;
    }

    // Final hash must equal the expected root
    root === hashes[depth];
}

component main { public [root] } = MerkleProofVerifier(20);
