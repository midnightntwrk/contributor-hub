fix: Consolidate and reorder README.md sections for clarity and reduce redundancy
Closes #316

# 👥 Contributor Hub

The **Contributor Hub** is the central collaborative platform for gathering and managing community-driven contributions within the `midnightntwrk` organization. It serves as the primary entry point for proposing new content, requesting features, reporting issues, or ideating for dApps on the Midnight Network.

## 🛠 How to Contribute

We welcome contributions of all types, including code, documentation, and technical content. For transparency in triage and task management, we utilize:
*   [Public Boards](https://github.com/orgs/midnightntwrk/projects/36): Our Contributor Board and Grab n Go Board are publicly accessible.
*   Inclusive Contribution: Our community is open to all, with guidelines for high-quality submissions.

### Submitting Issues & Content Proposals

We use GitHub Issue Forms to standardize submissions and make it easier for contributors. When creating a new issue, select the appropriate template from the "New Issue" page. This ensures relevant labels (e.g., `bug`, `feature-request`) are automatically applied for better categorization and efficient triage.

Available templates include:
*   **Bug Reports:** For reporting defects, errors, or unexpected behavior. Provide detailed information including steps to reproduce, expected behavior, environment details, and screenshots. Note: if a bug pertains to a specific repo (like `midnight-js`), report it there directly.
*   **Feature Requests / Suggestions:** For proposing new features, enhancements, or improvements to existing tools or processes. Clearly describe the proposed feature, its benefits, and the expected outcome.
*   **Content Proposals:** For suggesting new tutorials, blog posts, documentation improvements, or resources that educate or engage the community (e.g., the `[Tutorial] Anonymous Membership Proofs` from #316).
*   **dApp Proposals:** For ideas related to decentralized applications, including concepts, integrations, or improvements for dApps in our ecosystem.

## ⚙️ Our Contribution Workflow

Our workflow ensures every submission is reviewed fairly and efficiently, utilizing public boards for transparency: the [Contributor Board](https://github.com/orgs/midnightntwrk/projects/36) for triage and the Grab n Go Board for approved tasks.

### Contributor Board (Triage)
Issues enter the Contributor Board for initial review and categorization.
*   **New:** Entry point for fresh issues. Community members can view and comment.
*   **In Triage:** Active review by the triage committee (validity, priority, labels).
*   **Needs Discussion:** For issues requiring broader feedback or clarification.
*   **Rejected:** Invalid or out-of-scope issues, with explanations for transparency.

The triage committee periodically reviews issues. If legitimate, they add a `triaged` label, which moves the issue to the Grab n Go Board.

### Grab n Go Board (Ready for Work)
The Grab n Go Board showcases approved, ready-to-work-on tasks. It serves as a backlog for contributors.
*   **Ready:** Triaged issues awaiting pickup (e.g., labeled `good-first-issue` for beginners).
*   **In Progress:** Tasks being actively worked on. Contributors should assign themselves to issues and update progress via associated Pull Requests.
*   **Done:** Completed issues (automatically moves on PR merge/issue close).

### Pull Request Process

Once you've identified a task or proposed a contribution, follow these steps for code submissions:
1.  **Fork the Repo:** Create your own fork of the repository.
2.  **Create a Branch:** Use a descriptive name prefixed with a short moniker (e.g., `jill-my-feature`).
3.  **Follow Standards:** Adhere to the coding style guides and ensure new functionality includes unit and integration tests.
4.  **License Header:** Ensure all new files include the Apache-2.0 license header.
5.  **Submit:** Open a PR to the main repository. Avoid `--force` pushes to assist the review process. All PRs require review by at least one maintainer.

## 📅 Events & Showcases: Add Your Project

If you're participating in a Midnight event (such as **Hacktoberfest** or the **Midnight Summit**), you can showcase your work and contributions directly in this repository.

**Steps to Add Your Project:**
1.  Navigate to the `/events` folder.
2.  Open the folder for your specific event (e.g., `events/hacktoberfest-2025/`).
3.  Create a new Markdown file within that folder, named after your handle or team (e.g., `events/<event-slug>/<your-handle-or-team-slug>.md`).
4.  Copy and fill out the [submission template](./events/README.md). This template works for projects, tutorials, threads, or any other type of contribution.
5.  Commit your changes and open a Pull Request to the main repository.

Once your PR is merged, your submission will appear in the event’s showcase page automatically.
**Tip:** Keep filenames lowercase and hyphenated, and ensure your front-matter fields match the example format provided in the template.

## Bounty Programs

We run content and development bounties rewarded in NIGHT tokens. All participants must complete KYC verification before receiving tokens.
*   **[Bounty Program Terms](legal/BOUNTY_TERMS.md):** Standard terms for all bounty participants.
*   **[Contributor Agreement](legal/CONTRIBUTOR_AGREEMENT.md):** Additional terms for premium-tier engagements.
*   **[Submit a Bounty](../../issues/new?template=content-bounty.yml):** Use the Content Bounty issue template to submit your work.

## ⚖️ Governance & Security

*   **Code of Conduct:** We are committed to a positive, inclusive, and harassment-free environment. Please review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
*   **Security Policy:** Report security vulnerabilities privately via GitHub's private reporting or by emailing `security@midnight.foundation`.
*   **License:** This project is licensed under the **Apache License, Version 2.0**.