---
name: pnpm approval compatibility
description: Why newer pnpm releases can make the Ubuntu updater dirty its own checkout.
---

Treat dependency build approval as a versioned policy, not an install warning to ignore. Keep approval decisions explicit and limited to already approved packages.

**Why:** The Ubuntu updater repeatedly blocked itself after successful updates. Newer pnpm versions ignore the old approval setting and append undecided build placeholders to the tracked workspace configuration. Ignoring the installation error allowed builds to succeed but left local changes for the next update. pnpm documents `allowBuilds` support from 10.26.0 and removal of the older settings in 11.

**How to apply:** When this clean-checkout failure recurs, check the pnpm version and configuration diff instead of repeatedly restoring or stashing generated changes. Use compatible explicit approvals, fail on unknown install-script approvals, and verify consecutive installs leave configuration unchanged. Never disable the clean-checkout guard or approve all dependency scripts to hide this problem.
