---
title: VPS SSH identity picker plan
date: 2026-09-11
summary: "Plan: detect ~/.ssh keys and choose before VPS probe"
---

# VPS SSH identity picker plan

## What happened
Planned VPS SSH identity-file picker from the brainstorm contract (approach A: choose before probe).

Current `selectVpsHost` asks only for a host then calls `probeRemoteVps`. `sshInvocationArgs` never passes `-i`, so OpenSSH falls through to a password prompt.

## Decision
HOLD SCOPE. Fast plan, two phases:
1. `listSshIdentityFiles` + `sshInvocationArgs({ identityFile, passwordOnly })` pass-through.
2. TUI picker, CLI `--identity`, i18n, README, integration test.

Out of scope: persist identity, parse ssh_config, agent listing, key upload.

## Next steps
`/ak:cook plans/260911-0659-vps-ssh-identity-picker/plan.md`

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
