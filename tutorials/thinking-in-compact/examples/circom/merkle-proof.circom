// This file is part of midnightntwrk/contributor-hub.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

template MerkleProofVerifier(depth) {
    signal input root;
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output isValid;

    signal current[depth + 1];
    current[0] <== leaf;

    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== current[i] * (1 - pathIndices[i]) + pathElements[i] * pathIndices[i];
        hashers[i].inputs[1] <== pathElements[i] * (1 - pathIndices[i]) + current[i] * pathIndices[i];
        current[i + 1] <== hashers[i].out;
    }

    current[depth] === root;
    isValid <== 1;
}

component main { public [root] } = MerkleProofVerifier(3);
