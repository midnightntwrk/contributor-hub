<!--
This file is part of contributor-hub.
Copyright (C) 2026 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0.
-->

# DUST sponsorship example

This is a minimal, typecheckable boundary example for a Midnight DUST sponsor
service. It intentionally uses structural TypeScript interfaces instead of
importing the Wallet SDK, so the policy and DUST-only balancing behavior can be
tested without network keys, a proof server, or package registry access to the
official SDK.

In a real integration, the `SponsorWallet` implementation should be a
`WalletFacade` from `@midnight-ntwrk/wallet-sdk-facade`, initialized with the
official Wallet SDK packages listed in `../../tutorials/dust-sponsorship.md`.

## Validate

```sh
npm install
npm run typecheck
npm test
```
