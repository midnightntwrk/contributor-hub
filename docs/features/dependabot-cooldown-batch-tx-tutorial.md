# Dependabot Cooldown Policy
> Last updated: 2026-04-23

## Overview
The repository uses GitHub's Dependabot to automate dependency update PRs. A `cooldown` setting was introduced across all ecosystem entries in `.github/dependabot.yml` to prevent Dependabot from immediately proposing updates for freshly published package versions. This reduces PR noise caused by dependencies that release multiple patch versions in quick succession.

## How It Works
The `cooldown.default-days: 7` field, nested under each package ecosystem block in `.github/dependabot.yml`, instructs Dependabot to wait at least 7 days after a new version is published before opening an update PR. The active ecosystem is `github-actions` (directory `/`, weekly schedule). Three additional ecosystems — `cargo`, `npm`, and `docker` — are defined but commented out; each now includes the same cooldown block so the policy is ready to activate without further edits.

The relevant section of `.github/dependabot.yml` after this change:
```yaml
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    cooldown:
      default-days: 7
```

## Configuration
No environment variables are required. The cooldown is controlled entirely by the `cooldown.default-days` integer value in `.github/dependabot.yml`. To change the wait period, update that integer and commit to the default branch. To enable additional ecosystems, uncomment the relevant block — the `cooldown` entry is already present in each.

## Usage
No developer action is required after merge. Dependabot reads `.github/dependabot.yml` automatically. To enable the `cargo` ecosystem as an example, uncomment its block:
```yaml
  - package-ecosystem: "cargo"
    directory: "/"
    registries: "*"
    schedule:
      interval: "daily"
    cooldown:
      default-days: 7
```

## References
- Closes PR #317 (Dependabot cooldown configuration)
- GitHub Dependabot cooldown docs: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#cooldown