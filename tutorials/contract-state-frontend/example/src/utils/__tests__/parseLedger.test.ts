import { parseVotingLedger, parseLedgerDiff } from "../parseLedger";

describe("parseVotingLedger", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({
      proposal: "0xabcdef",
      votes_for: 42,
      votes_against: 7,
      deadline: "2026-06-01T00:00:00Z",
    });
    const result = parseVotingLedger(raw);
    expect(result.votes_for).toBe(42);
    expect(result.votes_against).toBe(7);
    expect(result.proposal).toBe("0xabcdef");
  });

  it("returns defaults on malformed JSON", () => {
    const result = parseVotingLedger("not json");
    expect(result.votes_for).toBe(0);
  });

  it("handles missing fields gracefully", () => {
    const raw = JSON.stringify({ votes_for: 10 });
    const result = parseVotingLedger(raw);
    expect(result.votes_for).toBe(10);
    expect(result.votes_against).toBe(0);
  });
});

describe("parseLedgerDiff", () => {
  it("parses a partial diff", () => {
    const raw = JSON.stringify({ votes_for: 43 });
    const diff = parseLedgerDiff(raw);
    expect(diff).toEqual({ votes_for: 43 });
  });
});
