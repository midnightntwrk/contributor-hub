type: tutorial
team_slug: contract-size-limits-tutorial
team_name: Midnight Contributors
project_title: "Contract Size Limits: What Happens When Your dApp Gets Too Complex"
repo_url: https://github.com/midnightntwrk/contributor-hub
demo_url:
link:
members:
  - name: Midnight Contributor
    github: midnightntwrk
tech_stack: Compact, TypeScript, Midnight SDK
tracks: [tutorial, smart-contracts, performance]
---

# Contract Size Limits: What Happens When Your dApp Gets Too Complex

As your Midnight dApp grows from a proof-of-concept into a production application, you will eventually encounter the hard boundaries built into the platform. Circuits start multiplying. State grows richer. Proof generation slows to a crawl. Then, one morning, your deployment transaction bounces with an opaque error. This tutorial explains exactly what those limits are, why they exist, and how to architect your contracts to stay well inside them.

## What Is a Circuit, Really?

Before diving into the limits, it helps to understand what you are counting when Midnight talks about circuits.

A **circuit** in Compact is a zero-knowledge proof statement. When you write:

