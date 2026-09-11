---
title: VPS SSH identity picker implemented
date: 2026-09-11
summary: TUI/CLI can pin an SSH identity file before VPS probe
---

# VPS SSH identity picker implemented

## What happened
Implemented VPS SSH identity picker from plans/260911-0659-vps-ssh-identity-picker.

Interactive VPS asked only for a host, then inherited stdin so OpenSSH fell through to a password prompt. There was no `-i` path.

## Decision
Approach A: detect private keys under ~/.ssh, choose before first probe, thread identityFile/passwordOnly through sshInvocationArgs.

Unreadable ~/.ssh (ENOENT/ENOTDIR/EACCES/EPERM) returns an empty list so default/path/password remain available.

## Next steps
Manual TUI smoke: Install a Kit → Remote VPS → host → identity list. Commit when the user asks.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
