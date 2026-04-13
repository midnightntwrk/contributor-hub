# Getting NIGHT Tokens on Midnight Network

This tutorial explains how to buy, move, store, and verify `NIGHT`, the native token of Midnight Network. It is written for users who want a practical, end-to-end path from acquisition to wallet funding and basic account checks.

> **Note**
> As of April 13, 2026, Midnight's public wallet-provider listings mention wallets such as Lace, Yoroi, NuFi, Ctrl Wallet, and GeroWallet, but I could not verify a public official listing for a wallet named **Thunderlight**. In this guide, "Thunderlight wallet" means a **Midnight-compatible wallet** that supports Midnight mainnet addresses and the standard Midnight DApp Connector API. If your Thunderlight build uses different menu labels, follow the same flow but verify every address format and network selection before sending funds.

## 1. What is NIGHT and what does it do?

`NIGHT` is the unshielded native and governance token of the Midnight ecosystem. Midnight is a privacy-first blockchain built around zero-knowledge proofs and selective disclosure, so it separates the token you hold from the resource you spend for transaction execution.

The key idea is Midnight's **token-generates-resource** model:

- `NIGHT` is the capital asset and governance token.
- `DUST` is the renewable network resource used to pay transaction fees.
- `DUST` is shielded and non-transferable.
- In practice, your wallet may show this as `Generate DUST`, `Register NIGHT`, or `Delegate for DUST`.

This matters because Midnight does **not** work like a typical gas-token chain where every interaction burns the core asset directly. Instead, holding or registering NIGHT gives your wallet the ability to generate DUST over time, which is then used for transaction fees. That design preserves governance exposure while making application usage more predictable for builders and users.

There is also a timeline detail worth understanding. Midnight announced the `NIGHT` launch on **December 4, 2025**, initially on Cardano as a Cardano Native Asset, with a protocol-level mirroring model planned for Midnight mainnet after genesis. That means liquidity, wallet support, and withdrawal routes may differ depending on where you acquired the asset:

- Some venues may support `NIGHT` trading but only offer Cardano withdrawals.
- Some wallets may support Cardano-held NIGHT before direct Midnight-held NIGHT.
- Some routes to Midnight may require a bridge or provider-specific transfer flow.

> **Tip**
> Before you move funds, answer one question first: **Where does my NIGHT currently live?**
> The answer determines whether you should use a centralized exchange withdrawal, a Cardano-to-Midnight route, or a third-party bridge flow.

## 2. Getting NIGHT from centralized exchanges

For most users, a centralized exchange is the simplest entry point. Midnight's official `Find NIGHT` page lists multiple exchange partners, including names such as Binance, Kraken, OKX, Bybit, Gate, KuCoin, Bitrue, Bitpanda, HTX, LBank, MEXC, and eToro. Availability varies by country, account type, and regulatory restrictions, so always confirm support in your jurisdiction before depositing fiat or crypto.

### Basic exchange workflow

1. Create or sign in to your exchange account.
2. Complete identity verification if the exchange requires it.
3. Deposit fiat or a base asset such as `USDT`, `USDC`, `BTC`, or `ETH`.
4. Search for the `NIGHT` trading pair that fits your funding asset, for example `NIGHT/USDT`.
5. Buy a small test amount first if you are new to the venue.
6. Confirm whether the exchange supports **withdrawal on Midnight mainnet**, **Cardano**, or another network representation.

### What to check before buying

- **Pair liquidity**: Thin markets can create slippage.
- **Withdrawal network**: A listing does not guarantee a Midnight mainnet withdrawal path.
- **Minimum withdrawal**: Exchanges often enforce minimum amounts.
- **Fee schedule**: Trading fee and withdrawal fee are separate.
- **Maintenance notices**: New assets often have temporary withdrawal pauses.

> **Warning**
> Do not assume "buying NIGHT" is the same as "receiving NIGHT on Midnight." Many exchanges list an asset before they support every withdrawal network. Confirm the destination chain first.

### Practical decision tree

- If the exchange supports **Midnight mainnet withdrawal**, send directly to your Midnight-compatible wallet.
- If the exchange supports only **Cardano withdrawal**, withdraw to a compatible Cardano wallet first, then use the Midnight route supported by your wallet or bridge provider.
- If the exchange supports only internal custody and no withdrawal yet, wait until withdrawals are enabled. Do not buy more than you are comfortable leaving on the exchange.

## 3. Bridging NIGHT to Midnight from Ethereum

This is the part that requires the most caution.

Midnight's public documentation clearly explains the Midnight token model and the Cardano-first launch, but it does **not** currently publish a canonical public walkthrough for a specific **Ethereum-to-Midnight NIGHT bridge**. Because bridge providers, supported routes, contract addresses, and minimums can change quickly, you should treat Ethereum bridging as a **provider-specific workflow**, not a fixed protocol workflow.

In practice, that means you should only bridge from Ethereum if **all** of the following are true:

1. You already hold a supported Ethereum-side representation of NIGHT, or the bridge explicitly accepts your source asset.
2. The bridge explicitly lists **Midnight** as the destination network.
3. Your destination wallet supports receiving Midnight mainnet funds.
4. You have enough `ETH` for source-chain gas.

### Safe bridging checklist

1. Open the bridge only from an official Midnight ecosystem source or the bridge provider's verified domain.
2. Connect your Ethereum wallet, usually MetaMask or a hardware-backed EVM wallet.
3. Connect your Midnight-compatible wallet, or paste your destination Midnight address if the bridge uses manual entry.
4. Verify the exact source asset and destination asset symbol.
5. Verify the destination network says `Midnight` or `Midnight mainnet`, not preview or preprod.
6. Send a **small test transfer first**.
7. Wait for source-chain confirmation, relay processing, and destination finality.
8. Refresh your Midnight wallet and confirm the asset arrived before sending a larger amount.

### Common bridge mistakes

- Sending to a Cardano address when the bridge expects a Midnight address.
- Pasting a shielded address when the bridge only supports unshielded deposits.
- Bridging to testnet by accident.
- Approving the wrong token contract.
- Using an aggregator or social link instead of the provider's verified site.

> **Warning**
> If a bridge asks you to approve a token contract, compare the token symbol, decimals, and contract address against trusted market-data sources and the bridge UI before approving. Never approve an unknown token because the symbol looks familiar.

> **Tip**
> If your goal is simply to fund a Midnight wallet, a CEX withdrawal is often lower risk than a bridge. Use Ethereum bridging only when you already hold the asset on Ethereum or you specifically need a self-custodial route.

## 4. Setting up a Midnight-compatible wallet (Thunderlight wallet)

For a Midnight-compatible wallet, you need three things:

- Midnight mainnet network support
- A visible `unshielded` address for receiving NIGHT
- Support for DUST generation or NIGHT registration

The official Midnight docs show this flow for Lace on test networks, and the same operational logic applies to a Midnight-compatible wallet on mainnet.

### Wallet setup steps

1. Install the wallet only from the publisher's verified site or a verified browser-extension store listing.
2. Create a new wallet or import an existing seed phrase.
3. Write the recovery phrase on paper and store it offline.
4. Set a strong device password.
5. Select `Midnight mainnet` as the active network if the wallet supports multiple networks.
6. Locate your addresses:
   - `mn_addr...` for unshielded NIGHT reception
   - `mn_shield-addr...` for shielded activity
   - `mn_dust...` for DUST-related operations when exposed by the wallet

### How to verify the wallet is ready

- The wallet opens without sync errors.
- The network is `mainnet`, not `preview`, `preprod`, or `undeployed`.
- Your receive screen shows a valid Midnight address.
- The wallet can display both balances and transaction history.

> **Warning**
> Never import your seed phrase into a second browser extension or website just to "check your balance." Use the original wallet app only.

### TypeScript: detect a Midnight-compatible wallet

The standard Midnight DApp Connector API exposes wallets under `window.midnight.{walletId}`. This snippet connects to a preferred wallet name, but falls back to any detected Midnight-compatible wallet if the specific provider is not found.

```ts
import "@midnight-ntwrk/dapp-connector-api";
import type {
  InitialAPI,
  WalletConnectedAPI,
} from "@midnight-ntwrk/dapp-connector-api";

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export async function connectPreferredWallet(
  preferredName = "Thunderlight",
): Promise<WalletConnectedAPI> {
  const providers = Object.values(window.midnight ?? {});

  if (providers.length === 0) {
    throw new Error("No Midnight-compatible wallet was detected.");
  }

  const selected =
    providers.find((wallet) =>
      wallet.name.toLowerCase().includes(preferredName.toLowerCase()),
    ) ?? providers[0];

  const api = await selected.connect("mainnet");
  const status = await api.getConnectionStatus();

  if (!status) {
    throw new Error("Wallet connection failed.");
  }

  return api;
}
```

## 5. Funding your wallet with NIGHT

Once the wallet is ready, fund it carefully. For most users, the safest first deposit is a **small test transfer**.

### Direct funding from an exchange

1. In your wallet, open **Receive**.
2. Copy your **unshielded Midnight address**.
3. On the exchange, open **Withdraw** for `NIGHT`.
4. Select the network that matches your wallet's receive address.
5. Paste the address carefully and confirm the first and last characters.
6. Send a small test amount.
7. Wait for confirmation, then send the remainder if the test succeeds.

### Funding through a bridge

1. Use the bridge flow described earlier.
2. Prefer the unshielded Midnight address unless the bridge explicitly supports shielded delivery.
3. Wait for the transfer to finalize.
4. Refresh your wallet and verify the balance before initiating any DUST-related action.

### Activating DUST

Depending on wallet design, simply holding NIGHT may not immediately make DUST spendable in the UI. Your wallet may require an explicit action such as:

- `Generate DUST`
- `Register NIGHT`
- `Delegate NIGHT for DUST`

If you see one of those actions, complete it after the NIGHT deposit arrives. The Midnight wallet SDK documentation describes this as registering NIGHT UTXOs for DUST generation.

> **Tip**
> Keep a small amount of NIGHT idle until you understand your wallet's DUST flow. Moving all coins immediately can make troubleshooting harder if your fee resource has not appeared yet.

## 6. Checking balance and transaction history

You should verify two things after funding:

- your wallet balance is correct
- your wallet history shows the incoming transaction

### In the wallet UI

Most Midnight-compatible wallets will show:

- `Unshielded balances`: where NIGHT usually appears
- `Shielded balances`: private assets if you use shielded transfers
- `DUST balance`: current fee resource and sometimes a cap
- `History` or `Activity`: incoming, outgoing, and registration transactions

If the wallet lags after a transfer:

1. Confirm the network is correct.
2. Refresh or resync the wallet.
3. Check whether the bridge or exchange shows the transfer as completed.
4. Wait a few minutes before retrying.

### TypeScript: read balances and recent history

The DApp Connector API exposes methods for balances, addresses, DUST, and transaction history.

```ts
import type { WalletConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

export async function readWalletState(api: WalletConnectedAPI) {
  const [
    shieldedBalances,
    unshieldedBalances,
    dustBalance,
    shieldedAddresses,
    unshieldedAddress,
    txHistory,
  ] = await Promise.all([
    api.getShieldedBalances(),
    api.getUnshieldedBalances(),
    api.getDustBalance(),
    api.getShieldedAddresses(),
    api.getUnshieldedAddress(),
    api.getTxHistory(0, 10),
  ]);

  return {
    shieldedBalances,
    unshieldedBalances,
    dustBalance,
    shieldedAddress: shieldedAddresses.shieldedAddress,
    unshieldedAddress: unshieldedAddress.unshieldedAddress,
    txHistory,
  };
}
```

You can format the result for a console dashboard:

```ts
export async function printWalletSummary(api: WalletConnectedAPI) {
  const state = await readWalletState(api);

  console.log("Unshielded address:", state.unshieldedAddress);
  console.log("Shielded address:", state.shieldedAddress);
  console.log("Unshielded balances:", state.unshieldedBalances);
  console.log("Shielded balances:", state.shieldedBalances);
  console.log("DUST:", {
    current: state.dustBalance.balance.toString(),
    cap: state.dustBalance.cap.toString(),
  });
  console.log("Recent history entries:", state.txHistory.length);
  console.table(state.txHistory);
}
```

> **Tip**
> If you are building tooling around Midnight wallets, avoid hardcoding a single wallet ID such as `mnLace`. Enumerate `window.midnight` and let the user choose the provider. That makes your integration work with future wallets, including Thunderlight if it exposes the standard connector.

## 7. Security best practices

Buying and moving tokens safely is mostly about process discipline.

### Wallet security

- Store the recovery phrase offline.
- Use a unique password and a locked device.
- Prefer hardware-backed signing when available.
- Keep browser extensions updated from official sources only.

### Transfer safety

- Always send a small test transaction first.
- Double-check the destination network every time.
- Compare the first and last characters of the address after pasting.
- Keep enough source-chain gas, such as `ETH`, for bridge transactions.

### Social engineering defense

- Do not trust wallet links from social replies or direct messages.
- Ignore "support" accounts asking for your seed phrase.
- Never sign arbitrary approvals if you do not understand what contract is being approved.
- Bookmark the exchange, bridge, and wallet sites you actually use.

### Operational discipline

- Record where you bought NIGHT, which network you withdrew on, and which address you used.
- Take screenshots of completed withdrawals and bridge confirmations.
- If a transaction is delayed, investigate first. Do not keep retrying with larger amounts.

> **Warning**
> `DUST` is a network resource, not a normal transferable token. If your wallet shows DUST-related actions, follow the wallet's intended flow rather than trying to "send DUST" somewhere else.

## Summary table

| Stage | What you do | What to verify | Common risk |
| --- | --- | --- | --- |
| Learn the model | Understand `NIGHT` and `DUST` | NIGHT is the token, DUST pays fees | Expecting Ethereum-style gas behavior |
| Buy on CEX | Trade into `NIGHT` | Withdrawal network matches your wallet | Buying before checking withdrawal support |
| Bridge from Ethereum | Move supported assets to Midnight | Official bridge, correct asset, test amount | Wrong network or wrong token approval |
| Set up wallet | Install and create/import wallet | Midnight mainnet, valid `mn_addr...` receive address | Fake extension or wrong network |
| Fund wallet | Withdraw or bridge into wallet | Test transfer arrives before full amount | Sending to unsupported address format |
| Verify state | Check balances and history | NIGHT appears, DUST flow is visible, history updates | Assuming a delay means funds are lost |
| Stay secure | Protect keys and approvals | Offline seed storage and verified domains | Phishing and blind signature approval |

## Final thoughts

The simplest path to holding NIGHT on Midnight is usually:

1. buy `NIGHT` on a reputable exchange,
2. confirm the supported withdrawal network,
3. send a small test amount to your Midnight-compatible wallet,
4. activate or verify DUST generation if your wallet requires it,
5. confirm the deposit in both balance and history views.

If you are starting from Ethereum, treat bridging as an advanced route and verify the bridge provider carefully. On Midnight, operational accuracy matters more than speed.

## References

- [Midnight NIGHT token overview](https://midnight.network/night)
- [Guide to the NIGHT token launch and Redemption](https://midnight.network/blog/guide-to-the-night-token-launch-and-redemption)
- [Midnight Docs](https://docs.midnight.network/)
- [Midnight DApp Connector API](https://docs.midnight.network/api-reference/dapp-connector)
- [Midnight Wallet SDK developer guide](https://docs.midnight.network/sdks/official/wallet-developer-guide)
- [Midnight ecosystem catalog](https://midnight.network/ecosystem-catalog)
