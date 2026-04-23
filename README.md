markdown
# 👥 Contributor Hub

The **Contributor Hub** is the central collaborative platform for gathering and managing community-driven contributions within the `midnightntwrk` organization. It serves as the primary entry point for proposing new content, requesting features, reporting issues, or ideating for dApps on the Midnight Network.

## 🛠 How to Contribute

- [Public Boards](https://github.com/orgs/midnightntwrk/projects/36): For transparency in triage and task management.
- Automated Workflow (coming soon): Issues are automatically added to boards and moved based on labels.
- Inclusive Contribution: Open to all, with guidelines for high-quality submissions.

We welcome contributions of all types, including code, documentation, and technical content.

### Submitting Issues
Use our GitHub Issue Forms to submit:
*   **Bug Reports:** Provide detailed information including steps to reproduce and expected behavior. Note: if a bug pertains to a specific repo (like `midnight-js`), report it there directly.
*   **Feature Requests:** Clearly describe the proposed feature, its benefits, and the expected outcome.
*   **Content Proposals:** Propose new tutorials, blog posts, or documentation improvements.
*   **dApp Proposal:** For ideas related to decentralized applications, including concepts, integrations, or improvements for dApps in our ecosystem.

To standardize submissions and make it easier for contributors, we provide the following issue templates:
- **Content Proposal:** For suggesting new content like articles, tutorials, or resources. Use this to propose ideas that educate or engage the community.
- **Feature Request/Suggestion:** For proposing new features, enhancements, or suggestions to improve existing tools or processes.
- **Bug:** For reporting defects, errors, or unexpected behavior. Include reproduction steps, environment details, and screenshots if possible.
- **dApp Proposal:** For ideas related to decentralized applications, including concepts, integrations, or improvements for dApps in our ecosystem.

When creating an issue, select the appropriate template from the "New Issue" page. This auto-applies relevant labels (e.g., `bug`, `feature-request-suggestion`) for better categorization.

### Pull Request Process
1.  **Fork the Repo:** Create your own fork of the repository.
2.  **Create a Branch:** Use a descriptive name prefixed with a short moniker (e.g., `jill-my-feature`).
3.  **Follow Standards:** Adhere to the coding style guides and ensure new functionality includes unit and integration tests.
4.  **License Header:** Ensure all new files include the Apache-2.0 license header.
5.  **Submit:** Open a PR to the main repository. Avoid `--force` pushes to assist the review process.

## ➡️ Workflow & Boards

Our workflow ensures every submission is reviewed fairly and efficiently. Issues start in the [Contributor Board](https://github.com/orgs/midnightntwrk/projects/36) for triage and, if approved, move to the Grab n Go Board for contributors to pick up. Both boards are public for transparency.

### Contributor Board (Triage)
Columns (based on the "Status" field):
- New: Entry point for fresh issues. Community members can view and comment.
- In Triage: Active review by the triage committee (validity, priority, labels).
- Needs Discussion: For issues requiring broader feedback or clarification.
- Rejected: Invalid or out-of-scope issues, with explanations for transparency.

The triage committee meets periodically to review and move issues. If legitimate, they add a `triaged` label, triggering an automation to move it to the Grab n Go Board.

### Grab n Go Board (Ready for Work)
The Grab n Go Board showcases approved, ready-to-work-on tasks. It's a backlog for contributors.
Columns (based on the "Status" field):
- Ready: Triaged issues awaiting pickup (e.g., labeled `good-first-issue` for beginners).
- In Progress: Tasks being worked on (assign yourself and update via PRs).
- Done: Completed issues (auto-moves on close).

Automations handle movement between boards and status updates for efficiency.

## 📅 Event Project Showcase

If you’re participating in a Midnight event such as a hackathon, summit, or Hacktoberfest, you can showcase your work and contributions directly in this repository.

**Steps:**

1.  Navigate to the `/events` folder.
2.  Open the folder for your event (e.g. `events/hacktoberfest-2025/`).
3.  Inside, create a new Markdown file named after your handle or team: `events/<event-slug>/<your-handle-or-team-slug>.md`
4.  Copy and fill out the [submission template](./events/README.md). It works for projects, tutorials, threads, or any other type of contribution.
5.  Commit and open a Pull Request.

Once your PR is merged, your submission will appear in the event’s showcase page automatically.

> **Tip:** Keep filenames lowercase and hyphenated, and make sure your front-matter fields match the example format.

## Bounty Programs

We run content and development bounties rewarded in NIGHT tokens. All participants must complete KYC verification before receiving tokens.

-   **[Bounty Program Terms](legal/BOUNTY_TERMS.md):** Standard terms for all bounty participants.
-   **[Contributor Agreement](legal/CONTRIBUTOR_AGREEMENT.md):** Additional terms for premium-tier engagements.
-   **[Submit a Bounty](../../issues/new?template=content-bounty.yml):** Use the Content Bounty issue template to submit your work.

## ⚖️ Governance & Security

*   **Code of Conduct:** We are committed to a positive, inclusive, and harassment-free environment. Please review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
*   **Security Policy:** Report security vulnerabilities privately via GitHub's private reporting or by emailing `security@midnight.foundation`.
*   **License:** This project is licensed under the **Apache License, Version 2.0**.

fix: Consolidate and clarify README.md contribution guidelines

This commit refactors the README.md to improve clarity and reduce redundancy in the contribution guidelines.

Changes include:
-   Consolidated "Code of Conduct" into the "Governance & Security" section.
-   Merged and refined the "Contributing" and "How to Contribute" sections, structuring all contribution steps under "How to Contribute".
-   Moved the detailed descriptions of issue templates directly under "Submitting Issues" for better context.
-   Expanded the initial "Submitting Issues" bullet points to include "dApp Proposal" for consistency with templates.
-   Consolidated "Events & Showcases" and "Adding Your Project to an Event" into a single, comprehensive "Event Project Showcase" section.
-   Renamed and added subheadings to the "Workflow" section for better readability of the Contributor and Grab n Go Boards.

These changes make it easier for contributors to understand how to propose content (like tutorials), submit issues, and participate in the community, addressing the general need for a clear contribution path implied by issues such as #315.

Closes #315