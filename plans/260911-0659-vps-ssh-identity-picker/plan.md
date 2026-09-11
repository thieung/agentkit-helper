---
title: "VPS SSH identity file picker"
description: "Detect local SSH identity files and let the user choose one before VPS probe, instead of falling through to a password prompt."
status: completed
priority: P2
effort: 3h
issue:
branch: main
tags: [feature, cli, auth]
blockedBy: []
blocks: []
created: 2026-09-11
---

# VPS SSH identity file picker

## Overview

Interactive VPS install/update currently asks only for a host, then runs system `ssh` with inherited stdin. There is no `-i` / `IdentityFile` option, so OpenSSH falls through to a password prompt when the default agent/config key is wrong. This plan adds local identity-file detection, a TUI choice before the first SSH, CLI `--identity`, and threads that choice through probe, bootstrap, install, and update.

## Cross-Plan Dependencies

None.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Detect private keys under `~/.ssh` without logging key material | P1 |
| 2 | Let the TUI user pick a key, SSH default, a custom path, or password before probe | P1 |
| 3 | Pass the choice on every SSH for that VPS session, including CLI `--identity` | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Identity discovery and SSH plumbing](./phase-01-start.md) | Pending |
| 2 | [TUI, CLI, i18n, and docs](./phase-02-tui-cli-wiring.md) | Pending |

## Success Criteria

- [x] After host selection, TUI lists detected identity files before probe
- [x] Chosen `-i` + `IdentitiesOnly=yes` appears on probe, bootstrap, install, and update SSH argv
- [x] Password is an explicit TUI option, not the only path
- [x] `akh install --ssh … --identity <path> --yes` uses that file; omitting `--identity` keeps current default SSH behavior
- [x] EN/VI copy and README mention `--identity`
- [x] `npm test` covers discovery, argv, args parsing, and one remote CLI path

## Scope (HOLD)

**In:** detect + choose + thread identity; password as last TUI option; `--identity` for install/update + `--ssh`.

**Out:** persist identity in `config.json`; parse `~/.ssh/config`; ssh-agent listing; generate/upload keys; `pi-ak`/`pi-omp` over SSH.

## Next

`/ak:cook plans/260911-0659-vps-ssh-identity-picker/plan.md`

<!-- slug: vps-ssh-identity-picker -->
