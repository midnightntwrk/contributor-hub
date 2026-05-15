import React from "react";
import { useContractActions } from "../hooks/useContractActions";
import { parseLedgerDiff } from "../utils/parseLedger";

export const LiveActionsFeed: React.FC = () => {
  const { actions, latestAction, loading, error } = useContractActions();

  if (loading) return <div className="feed">Connecting to live feed...</div>;
  if (error) return <div className="feed error">Error: {error.message}</div>;

  return (
    <div className="feed">
      <h2>Live Contract Actions</h2>
      {latestAction && (
        <div className="latest-action">
          <h3>Latest Action</h3>
          <p><strong>Type:</strong> {latestAction.actionType}</p>
          <p><strong>Tx:</strong> {latestAction.transactionHash}</p>
          <p><strong>Time:</strong> {latestAction.timestamp}</p>
        </div>
      )}
      <h3>Recent History</h3>
      {actions.length === 0 ? (
        <p>No actions received yet. Waiting for contract events...</p>
      ) : (
        <ul>
          {actions.map((action, idx) => {
            const diff = parseLedgerDiff(action.ledgerDiff);
            return (
              <li key={`${action.transactionHash}-${idx}`}>
                <span className="action-type">{action.actionType}</span>{" "}
                <span className="action-tx">{action.transactionHash.slice(0, 12)}...</span>{" "}
                <span className="action-time">{action.timestamp}</span>
                {Object.keys(diff).length > 0 && (
                  <pre className="diff">{JSON.stringify(diff, null, 2)}</pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
