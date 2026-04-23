fix: Refactor README.md for clarity and remove duplicate sections

This commit refactors the `README.md` file to improve clarity, streamline information, and eliminate redundant sections. The goal is to provide a more concise and organized guide for contributors.

Key changes include:
- Consolidating information about issue submission by merging the initial "Submitting Issues" section with the later detailed description of issue templates.
- Simplifying the "Pull Request Process" within "How to Contribute" to refer to the comprehensive "Contributing" section at the end of the document.
- Removing duplicate mentions of the "Code of Conduct" by retaining only the reference under "Governance & Security."
- Unifying the "Events & Showcases" instructions by removing the abbreviated steps and directing users to the more detailed "Adding Your Project to an Event" section.
- Ensuring a logical flow of information, starting with general contribution guidelines and progressing to specific processes like workflow, bounty programs, and detailed technical contribution steps.

Closes #319

markdown
# 👥 Contributor Hub

The **Contributor Hub** is the central collaborative platform for gathering and managing community-driven contributions within the `midnightntwrk` organization. It serves as the primary entry point for proposing new content, requesting features, reporting issues, or ideating for dApps on the Midnight Network.

## 🛠 How to Contribute

- [Public Boards](https://github.com/orgs/midnightntwrk/projects/36): For transparency in triage and task management.
- Automated Workflow (coming soon): Issues are automatically added to boards and moved based on labels.
- Inclusive Contribution: Open to all, with guidelines for high-quality submissions.

We welcome contributions of all types, including code, documentation, and technical content.

### Submitting Issues

To standardize submissions and make it easier for contributors, we provide dedicated GitHub Issue Forms. When creating an issue, select the appropriate template from the "New Issue" page. This auto-applies relevant labels (e.g., `bug`, `feature-request-suggestion`) for better categorization.

Use our GitHub Issue Forms to submit:
*   **Bug Reports:** For reporting defects, errors, or unexpected behavior. Provide detailed information including steps to reproduce, environment details, expected behavior, and screenshots if possible. Note: if a bug pertains to a specific repo (like `midnight-js`), report it there directly.
*   **Feature Requests/Suggestions:** For proposing new features, enhancements, or suggestions to improve existing tools, processes, or the network itself. Clearly describe the proposed feature, its benefits, and the expected outcome.
*   **Content Proposals:** For suggesting new content like articles, tutorials, blog posts, documentation improvements, or resources. Use this to propose ideas that educate or engage the community.
*   **dApp Proposal:** For ideas related to decentralized applications, including concepts, integrations, or improvements for dApps in our ecosystem.

### Pull Request Process

For all code contributions and improvements to the repository, please refer to the detailed [Contributing](#contributing) section for comprehensive guidelines on forking, branching, adhering to coding standards, testing, and submitting pull requests.

## 📅 Events & Showcases

If you are participating in a Midnight event (such as **Hacktoberfest** or the **Midnight Summit**), you can showcase your work here.
Refer to the [Adding Your Project to an Event](#adding-your-project-to-an-event) section for detailed submission instructions.

## Bounty Programs

We run content and development bounties rewarded in NIGHT tokens. All participants must complete KYC verification before receiving tokens.

- **[Bounty Program Terms](legal/BOUNTY_TERMS.md):** Standard terms for all bounty participants.
- **[Contributor Agreement](legal/CONTRIBUTOR_AGREEMENT.md):** Additional terms for premium-tier engagements.
- **[Submit a Bounty](../../issues/new?template=content-bounty.yml):** Use the Content Bounty issue template to submit your work.

## ⚖️ Governance & Security

*   **Code of Conduct:** We are committed to a positive, inclusive, and harassment-free environment. Please review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
*   **Security Policy:** Report security vulnerabilities privately via GitHub's private reporting or by emailing `security@midnight.foundation`.
*   **License:** This project is licensed under the **Apache License, Version 2.0**.

## Workflow

Our workflow ensures every submission is reviewed fairly and efficiently. Issues start in the [Contributor Board](https://github.com/orgs/midnightntwrk/projects/36) for triage and, if approved, move to the Grab n Go Board for contributors to pick up. Both boards are public for transparency.

Columns (based on the "Status" field):

-   New: Entry point for fresh issues. Community members can view and comment.
-   In Triage: Active review by the triage committee (validity, priority, labels).
-   Needs Discussion: For issues requiring broader feedback or clarification.
-   Rejected: Invalid or out-of-scope issues, with explanations for transparency.

The triage committee meets periodically to review and move issues. If legitimate, they add a `triaged` label, triggering an automation to move it to the Grab n Go Board.

## Grab n Go Board

The Grab n Go Board showcases approved, ready-to-work-on tasks. It's a backlog for contributors.Columns (based on the "Status" field):
-   Ready: Triaged issues awaiting pickup (e.g., labeled good-first-issue for beginners).
-   In Progress: Tasks being worked on (assign yourself and update via PRs).
-   Done: Completed issues (auto-moves on close).

Automations handle movement between boards and status updates for efficiency.

## Contributing

We welcome contributions from everyone! Follow these steps:

-   Fork the Repo: Click "Fork" on the top right.
-   Create an Issue: Use templates to submit ideas or bugs.
-   Work on Tasks: Browse the Grab n Go Board, assign yourself to a "Ready" issue.
-   Submit a Pull Request: Want to improve Community-hub? Submit a PR and follow our CONTRIBUTING.md for details on code style, testing, and commits.
-   Labels and Priorities: Use labels like priority:high, help-wanted, or good-first-issue to guide contributions.

For non-code contributions (e.g., docs, proposals), submit via issues. All PRs require review by at least one maintainer.

## Adding Your Project to an Event

If you’re participating in a Midnight event such as a hackathon, summit, or Hacktoberfest, you can showcase your work and contributions directly in this repository.

**Steps:**

1.  Navigate to the `/events` folder.
2.  Open the folder for your event (e.g. `events/hacktoberfest-2025/`).
3.  Inside, create a new Markdown file named after your handle or team: events/<event-slug>/<your-handle-or-team-slug>.md
4.  Copy and fill out the [submission template](./events/README.md). It works for projects, tutorials, threads, or any other type of contribution.
5.  Commit and open a Pull Request.

Once your PR is merged, your submission will appear in the event’s showcase page automatically.

> **Tip:** Keep filenames lowercase and hyphenated, and make sure your front-matter fields match the example format.