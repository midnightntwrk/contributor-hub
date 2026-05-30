# Witnesses in Depth: Patterns, Types, and Real Use Cases

Zero-knowledge proofs are powerful — but only if you can feed them the right inputs. In Midnight's Compact language, **witnesses** are the mechanism that lets off-chain computation hand private data into an on-chain ZK circuit without ever exposing the underlying secrets. This tutorial takes a deep dive into what witnesses are, how they differ from circuit logic, and the patterns you will reach for repeatedly when building real dApps.

---

## What Is a Witness?

A witness is a function that executes **off-chain**, on the user's device, and whose output is provided as a private input to the ZK circuit at proof-generation time. The circuit does not run the witness; it only sees the return value and uses that value inside assertions.

Think of the circuit as the verifier and the witness as the prover. The witness says "here is the answer"; the circuit says "I will not accept this proof unless the answer satisfies these constraints."

In Compact, a witness is declared with the `witness` keyword:

