import React, { useState } from 'react';

export const TokenUI: React.FC = () => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');

  const handleTransfer = async () => {
    setStatus('Generating zero-knowledge proof...');
    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, amount }),
      });
      const data = await res.json();
      setStatus(data.success ? `TX: ${data.txHash}` : 'Transfer failed');
    } catch (err) {
      setStatus('Error: ' + (err as Error).message);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>🔒 Private Transfer</h2>
      <input
        placeholder="Recipient address"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        style={{ width: '100%', marginBottom: '10px', padding: '8px' }}
      />
      <input
        placeholder="Amount"
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ width: '100%', marginBottom: '10px', padding: '8px' }}
      />
      <button onClick={handleTransfer} style={{ padding: '10px 20px' }}>
        Send Privately
      </button>
      {status && <p style={{ marginTop: '15px' }}>{status}</p>}
    </div>
  );
};
