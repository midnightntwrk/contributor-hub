const { balanceUnboundTransaction, signTransaction } = require('midnight-mcp');

class SponsorService {
  constructor(sponsor) {
    this.sponsor = sponsor;
  }

  async sponsorTransaction(transaction, user) {
    try {
      // Balance the transaction with the sponsor's DUST
      const balancedTransaction = await balanceUnboundTransaction(transaction, {
        tokenKindsToBalance: ["dust"],
        sponsor: this.sponsor
      });

      // Sign the transaction on behalf of the user
      const signedTransaction = await signTransaction(balancedTransaction, user.privateKey);

      return signedTransaction;
    } catch (error) {
      console.error('Error sponsoring transaction:', error);
      throw error;
    }
  }
}

module.exports = SponsorService;