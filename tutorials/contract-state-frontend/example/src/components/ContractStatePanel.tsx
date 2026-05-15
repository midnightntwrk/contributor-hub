import React from "react";
import { useContractState } from "../hooks/useContractState";
import { parseVotingLedger } from "../utils/parseLedger";

export const ContractStatePanel: React.FC = () => {
  const { data, loading, error, refetch } = useContractState();

  if (loading) return <div className="panel">Loading contract state...</div>;
  if (error)
    return (
      <div className="panel error">
        <p>Error loading state: {error.message}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  if (!data) return <div className="panel">No contract state found.</div>;

  const ledger = parseVotingLedger(data.ledger_state);

  return (
    <div className="panel">
      <h2>Contract State</h2>
      <p><strong>Address:</strong> {data.contract_address}</p>
      <p><strong>Proposal:</strong> {ledger.proposal}</p>
      <p><strong>Votes For:</strong> {ledger.votes_for}</p>
      <p><strong>Votes Against:</strong> {ledger.votes_against}</p>
      <p><strong>Deadline:</strong> {ledger.deadline}</p>
      <p><strong>Last Updated:</strong> {data.updated_at}</p>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
};
