# Building an unshielded token DApp with UI on Midnight

**Target audience:** Developers new to Midnight who want a simpler on-ramp than shielded tokens.

**Repository:** [unshielded-token-dapp](https://github.com/advancedresearcharray/unshielded-token-dapp)

This tutorial walks you through building a complete Midnight DApp that mints, sends, and receives **unshielded tokens** using a Compact smart contract and a React frontend. Unshielded tokens keep amounts and addresses public on-chain, which makes them easier to reason about while you learn Midnight's tooling.

By the end you will have:

- A compilable Compact smart contract using `mintUnshieldedToken`, `sendUnshielded`, and `receiveUnshielded`
- A TypeScript integration layer built on `@midnight-ntwrk/midnight-js`
- A React UI with wallet connection, mint, transfer, receive, and balance display
- A clear picture of when unshielded tokens are appropriate versus shielded tokens

## What are unshielded tokens?

Midnight supports two token models:

| Feature | Unshielded tokens | Shielded tokens |
| --- | --- | --- |
| Privacy | Public amounts and addresses | Private via zero-knowledge proofs |
| API complexity | Straightforward mint/send/receive | Coin witnesses and proof management |
| Typical use cases | Governance, treasuries, audit trails | Confidential transfers, private DeFi |
| Learning curve | Lower | Higher |

Unshielded tokens are an excellent first project because you can focus on wallet connectivity, circuit calls, and indexer queries without managing a private coin pool.

## Prerequisites

Before you begin, install:

- **Node.js** 20 or later
- **npm** or **pnpm**
- A Midnight wallet extension such as Lace or 1AM
- Preprod test tokens from the [Midnight faucet](https://faucet.preprod.midnight.network/)

Install the Compact toolchain:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
```

Clone the tutorial repository:

```bash
git clone https://github.com/advancedresearcharray/unshielded-token-dapp.git
cd unshielded-token-dapp
npm install
```

## Project layout

```text
unshielded-token-dapp/
├── contracts/
│   ├── unshielded-token.compact
│   └── managed/unshielded-token/   # compiled artefacts
├── public/managed/unshielded-token/ # artefacts served to the browser
├── src/
│   ├── lib/contractCalls.ts        # TypeScript smart contract API
│   ├── hooks/useWallet.ts          # wallet + operation state
│   └── App.tsx                     # React UI
└── TUTORIAL.md
```

The frontend reads compiled prover and verifier keys from `public/managed/unshielded-token`, so keep that directory in sync after every compile.

## Writing the Compact smart contract

Create `contracts/unshielded-token.compact`. The smart contract tracks how many tokens have been minted and exposes four circuits.

**Mint into the vault** with `mintUnshieldedToken`:

```compact
export circuit mintToContract(amount: Uint<64>): Bytes<32> {
    const domain = pad(32, "tutorial:unshielded:v1");
    const color = mintUnshieldedToken(
        disclose(domain),
        disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self())
    );
    totalMinted = totalMinted + disclose(amount) as Uint<64>;
    return color;
}
```

`left<ContractAddress, UserAddress>(kernel.self())` tells the runtime to credit the smart contract itself. The returned `color` is the token identifier your UI will later query.

**Send to a user** with `sendUnshielded`:

```compact
export circuit sendToUser(amount: Uint<64>, recipient: UserAddress): [] {
    const domain = pad(32, "tutorial:unshielded:v1");
    const color = tokenType(disclose(domain), kernel.self());
    sendUnshielded(
        color,
        disclose(amount) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(recipient))
    );
}
```

`tokenType` must use the same domain string and smart contract address that were used during minting. `right<…>` marks the recipient as a user address rather than another smart contract.

**Receive deposits** with `receiveUnshielded`:

```compact
export circuit receiveTokens(amount: Uint<128>): [] {
    const domain = pad(32, "tutorial:unshielded:v1");
    const color = tokenType(domain, kernel.self());
    receiveUnshielded(color, disclose(amount));
}
```

Note the `Uint<128>` parameter here. Minting uses `Uint<64>`, but `receiveUnshielded` requires the wider type.

### Compiling the smart contract

Compile and copy artefacts into the public folder:

```bash
npm run compile
```

You should see `Compiling 4 circuits` and fresh files under `contracts/managed/unshielded-token/keys`. If you change the smart contract you must redeploy, because verifier keys are tied to the compiled output.

> **Disclaimer:** This tutorial smart contract has no access control. Anyone can mint. Use it for learning only.

## TypeScript integration

The browser talks to Midnight through a set of providers. `src/lib/contractCalls.ts` wires them together:

- `privateStateProvider` — local encrypted state via `levelPrivateStateProvider`
- `publicDataProvider` — on-chain reads through the Preprod indexer
- `zkConfigProvider` — loads verifier metadata from `/managed/unshielded-token`
- `proofProvider` — uses the wallet's DApp connector proof provider
- `walletProvider` — balances transactions with `balanceUnsealedTransaction`
- `midnightProvider` — submits transactions with `submitTransaction`

The mint flow follows four steps:

1. Build providers from the connected wallet API.
2. Load the compiled smart contract with `CompiledContract.make`.
3. Attach to a deployed address via `findDeployedContract`.
4. Call `contract.callTx.mintToContract(amount)`.

```typescript
const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract,
  privateStateId: 'unshieldedTokenState',
  initialPrivateState: {},
});

const txData = await contract.callTx.mintToContract(amount);
const tokenId = uint8ArrayToHex(txData.private.result as Uint8Array);
```

`sendToUser` and `receiveTokens` follow the same pattern. For transfers you must decode the recipient's Bech32m unshielded address into raw bytes:

```typescript
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

const parsed = MidnightBech32m.parse(recipientAddress);
const decoded = parsed.decode(UnshieldedAddress, 'preprod');
await contract.callTx.sendToUser(amount, { bytes: decoded.data });
```

To display balances, query both the wallet and the indexer:

- `connectedApi.getUnshieldedBalances()` returns the user's holdings keyed by token ID.
- `provider.queryContractState(contractAddress)` exposes the vault balance and ledger fields such as `totalMinted`.

## Building the React frontend

`src/hooks/useWallet.ts` stores wallet connection state with Zustand. On connect it:

1. Detects compatible wallets from `window.midnight`.
2. Calls `wallet.connect('preprod')`.
3. Reads the unshielded address with `getUnshieldedAddress()`.
4. Polls balances after every successful operation.

`src/App.tsx` renders the operational UI:

1. **Connect wallet** — Lace or 1AM via the DApp connector API.
2. **Deploy or select a smart contract** — stores the address in `localStorage`.
3. **Mint** — credits the vault through `mintToContract`.
4. **Send** — moves tokens from the vault to any unshielded address.
5. **Receive** — deposits wallet-held tokens back into the vault.
6. **Balance panel** — shows vault balance, wallet balance, and total minted.

Run the development server:

```bash
npm run dev
```

Open `http://localhost:5173`, connect your wallet, deploy a fresh smart contract, and walk through mint → send → receive. Refresh the balance panel between steps to confirm state changes.

### Typical user flow

1. Deploy the smart contract and copy the address into the dashboard.
2. Mint tokens into the vault.
3. Send a portion to your own unshielded address.
4. Confirm the wallet balance increases in the UI.
5. Receive tokens back into the vault to practise the deposit path.

## Unshielded vs shielded: when to use which

Choose **unshielded tokens** when transparency is a feature:

- DAO treasuries that must be publicly verifiable
- Reward programmes where recipients should be auditable
- Regulated assets that require traceability

Choose **shielded tokens** when confidentiality matters:

- Peer-to-peer transfers where amounts should stay private
- DeFi positions you do not want publicly enumerated
- Salary or payroll flows with sensitive values

Many production DApps combine both: public governance tokens alongside shielded utility balances. Start unshielded to learn the request lifecycle, then graduate to shielded flows once you are comfortable with providers, witnesses, and proof generation.

## Deploying to Preprod

The UI includes a **Deploy new** button that calls `deployContract` from `@midnight-ntwrk/midnight-js-contracts`. Deployment uses the same provider stack as circuit calls, which keeps proof generation consistent across every operation. After confirmation, the smart contract address is saved to `localStorage` so a page refresh does not lose your session.

If you prefer not to deploy locally, paste any previously deployed tutorial address into the contract field and click **Use address**. The dashboard will query that smart contract's vault balance through the indexer.

Keep these deployment details in mind:

- Every compile produces a unique verifier set. Frontend keys must match the on-chain deployment.
- Preprod deployments require synced Preprod NIGHT for transaction fees.
- The tutorial network ID is hard-coded to `preprod` in `src/lib/constants.ts`.

## Understanding the provider stack

Midnight DApps do not talk to the chain directly. They compose providers that each handle one concern:

```typescript
const providers = {
  privateStateProvider,  // encrypted local state
  publicDataProvider,    // indexer queries
  zkConfigProvider,      // verifier metadata
  proofProvider,         // wallet-backed proof generation
  walletProvider,        // transaction balancing
  midnightProvider,      // submission to the network
};
```

The critical design choice in this tutorial is the proof provider. We use `dappConnectorProofProvider` so every circuit—deploy, mint, send, and receive—routes proofs through the wallet extension. That avoids mixing a local proof server with wallet-backed deploys, a common source of `ERR_CONNECTION_REFUSED` errors during development.

In production you would initialise this object once and reuse it across components. The tutorial rebuilds providers inside each call so the file structure stays easy to follow.

## Reading on-chain state

Public smart contract fields such as `totalMinted` are readable through the indexer. The helper `getContractLedgerState` deserialises ledger data with the generated `ledger()` function from the compiled module:

```typescript
const contractState = await provider.queryContractState(contractAddress);
const ledgerState = contractModule.ledger(contractState.data);
console.log(ledgerState.totalMinted.toString());
```

Vault token balances live on the contract state's `balance` map. Iterate the entries to discover the token ID and amount held by the smart contract. Wallet-side balances come from the DApp connector instead, because those funds sit in the user's unshielded wallet rather than the contract vault.

## Frontend state management

`useWalletStore` centralises connection status, selected smart contract, token ID, and the latest transaction hash. After each successful circuit call the store invokes `refreshBalances()` so the UI reflects new vault and wallet balances without a manual page reload.

The UI deliberately resets status messages when you click **Dismiss**, which prevents stale success banners from blocking forms on subsequent operations—a small but important quality-of-life detail when demoing the DApp to new contributors.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `No compatible wallet` | Extension missing or outdated | Install Lace/1AM and refresh |
| Proof errors on mint | Stale managed artefacts | Run `npm run compile` and redeploy |
| Zero vault balance after mint | Wrong contract address selected | Paste the deploy address again |
| Invalid recipient | Malformed Bech32m string | Copy the full unshielded address from your wallet |
| Transaction hangs on proof | Wallet locked or on wrong network | Unlock the wallet and confirm Preprod |

## Next steps

- Add access control to the mint circuit before moving beyond tutorials.
- Explore shielded token flows in the Midnight documentation.
- Publish your own Dev.to article with `#MidnightforDevs` and tag `@midnightntwrk`.

## Resources

- [Midnight documentation](https://docs.midnight.network/getting-started)
- [DApp connector API reference](https://docs.midnight.network/develop/reference/midnight-api/dapp-connector)
- [Midnight developer forum](https://forum.midnight.network/)
- [Discord](https://discord.com/invite/midnightnetwork)
