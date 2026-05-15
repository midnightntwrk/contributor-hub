export interface VotingLedger {
  proposal: string;
  votes_for: number;
  votes_against: number;
  deadline: string;
}

export function parseVotingLedger(rawLedgerState: string): VotingLedger {
  try {
    const parsed = JSON.parse(rawLedgerState);
    return {
      proposal: parsed.proposal ?? "0x0",
      votes_for: Number(parsed.votes_for ?? 0),
      votes_against: Number(parsed.votes_against ?? 0),
      deadline: parsed.deadline ?? "unknown",
    };
  } catch (err) {
    console.error("Failed to parse ledger state:", err);
    return { proposal: "0x0", votes_for: 0, votes_against: 0, deadline: "unknown" };
  }
}

export function parseLedgerDiff(rawDiff: string): Partial<VotingLedger> {
  try {
    return JSON.parse(rawDiff);
  } catch (err) {
    console.error("Failed to parse ledger diff:", err);
    return {};
  }
}
