import { useState } from "react";
import {
  VotingPhase,
  VoteOption,
  createVotingContract,
  computeCommitment,
  computeNullifier,
  type VotingConfig,
} from "../voting-contract";

interface VotingState {
  phase: VotingPhase;
  myCommitted: boolean;
  myRevealed: boolean;
  yesCount: number;
  noCount: number;
}

export function VotingApp() {
  const [config] = useState<VotingConfig>(() => ({
    title: " Governance Proposal #1",
    description: "Should we upgrade the protocol?",
    commitDuration: 86400n,
    revealDuration: 86400n,
    secretKey: generateSecretKey(),
  }));

  const [contract] = useState(() => createVotingContract(config));
  const [state, setState] = useState<VotingState>({
    phase: VotingPhase.INIT,
    myCommitted: false,
    myRevealed: false,
    yesCount: 0,
    noCount: 0,
  });
  const [vote, setVote] = useState<VoteOption>(VoteOption.YES);
  const [secretKey, setSecretKey] = useState(() => generateSecretKey());
  const [salt, setSalt] = useState(() => generateRandomSalt());

  const handleCommit = async () => {
    const commitment = computeCommitment(
      VoteOption.YES,
      secretKey,
      salt
    );
    console.log("Commitment:", commitment);
    setState((s) => ({ ...s, myCommitted: true }));
  };

  const handleReveal = async () => {
    const nullifier = computeNullifier(secretKey);
    console.log("Nullifier:", nullifier);
    setState((s) => ({
      ...s,
      myRevealed: true,
      yesCount: s.yesCount + (vote === VoteOption.YES ? 1 : 0),
      noCount: s.noCount + (vote === VoteOption.NO ? 1 : 0),
    }));
  };

  const getPhaseLabel = (phase: VotingPhase) => {
    switch (phase) {
      case VotingPhase.INIT:
        return "Setup";
      case VotingPhase.COMMIT:
        return "Commit Phase";
      case VotingPhase.REVEAL:
        return "Reveal Phase";
      case VotingPhase.ENDED:
        return "Voting Ended";
    }
  };

  return (
    <div className="voting-app">
      <h1>{config.title}</h1>
      <p className="description">{config.description}</p>

      <div className="phase-badge">
        Phase: {getPhaseLabel(state.phase)}
      </div>

      <div className="vote-section">
        <h2>Cast Your Vote</h2>
        
        {!state.myCommitted ? (
          <button onClick={handleCommit} disabled={state.phase !== VotingPhase.COMMIT}>
            Commit Vote
          </button>
        ) : state.myRevealed ? (
          <div className="vote-revealed">
            Your vote has been recorded
          </div>
        ) : (
          <button onClick={handleReveal} disabled={state.phase !== VotingPhase.REVEAL}>
            Reveal Vote
          </button>
        )}

        <div className="options">
          <label>
            <input
              type="radio"
              name="vote"
              value={VoteOption.YES}
              checked={vote === VoteOption.YES}
              onChange={() => setVote(VoteOption.YES)}
            />
            Yes
          </label>
          <label>
            <input
              type="radio"
              name="vote"
              value={VoteOption.NO}
              checked={vote === VoteOption.NO}
              onChange={() => setVote(VoteOption.NO)}
            />
            No
          </label>
        </div>
      </div>

      <div className="results">
        <h2>Current Results</h2>
        <div className="tally">
          <span className="yes">Yes: {state.yesCount}</span>
          <span className="no">No: {state.noCount}</span>
        </div>
      </div>
    </div>
  );
}

function generateSecretKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function generateRandomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}