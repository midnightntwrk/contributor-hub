const { balanceUnboundTransaction } = require('midnight-mcp');

async function balanceTransaction(transaction, sponsor) {
  try {
    const balancedTransaction = await balanceUnboundTransaction(transaction, {
      tokenKindsToBalance: ["dust"],
      sponsor: sponsor
    });
    return balancedTransaction;
  } catch (error) {
    console.error('Error balancing transaction:', error);
    throw error;
  }
}

module.exports = balanceTransaction;