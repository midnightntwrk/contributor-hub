/**
 * Privacy Token API Client
 * Midnight Network dApp Example
 */

import { CompactRuntime, ContractAddress, WalletAPI } from '@midnight-ntwrk/api';

export class PrivacyTokenClient {
  private contract: any;
  private wallet: WalletAPI;
  private runtime: CompactRuntime;

  constructor(wallet: WalletAPI) {
    this.wallet = wallet;
    this.runtime = new CompactRuntime(wallet);
  }

  async deploy(initialSupply: bigint): Promise<ContractAddress> {
    const { contract, address } = await this.runtime.deploy('PrivacyToken', [
      this.wallet.publicKey,
      initialSupply,
    ]);
    this.contract = contract;
    console.log('Contract deployed at:', address);
    return address;
  }

  async connect(address: ContractAddress): Promise<void> {
    this.contract = await this.runtime.connect('PrivacyToken', address);
  }

  async mint(to: string, amount: bigint): Promise<string> {
    const tx = await this.contract.mint(to, amount);
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }

  async transfer(to: string, amount: bigint): Promise<string> {
    const balanceProof = await this.wallet.generateProof(this.contract, 'balance');
    const nullifier = await this.wallet.generateNullifier();
    const tx = await this.contract.transfer(to, amount, nullifier, balanceProof);
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }

  async burn(amount: bigint): Promise<string> {
    const balanceProof = await this.wallet.generateProof(this.contract, 'balance');
    const tx = await this.contract.burn(amount, balanceProof);
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }

  async getTotalSupply(): Promise<bigint> {
    return await this.contract.getTotalSupply();
  }
}
