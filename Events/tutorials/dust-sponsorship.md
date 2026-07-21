# DUST Sponsorship: How One Wallet Pays Fees for Another User's Transaction

## Introduction

This tutorial explains how to implement a DUST sponsorship system where one wallet (the sponsor) can pay transaction fees for another wallet (the user). This is particularly useful when the user doesn't have enough DUST to cover the transaction fees.

## Prerequisites

- Basic understanding of Midnight Network and its architecture
- Familiarity with JavaScript and Node.js
- Midnight MCP installed and configured

## The Sponsorship Flow

The sponsorship flow involves the following steps:

1. The sponsor calls `balanceUnboundTransaction` with `tokenKindsToBalance: ["dust"]` on behalf of the user.
2. The user's transaction is balanced with the sponsor's DUST.
3. The transaction is signed and submitted to the network.

## `balanceUnboundTransaction` with `tokenKindsToBalance: ["dust"]`

The `balanceUnboundTransaction` function is used to balance a transaction with the specified token kinds. In this case, we're balancing the transaction with the sponsor's DUST.