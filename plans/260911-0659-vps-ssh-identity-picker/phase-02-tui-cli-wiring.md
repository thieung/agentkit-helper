---
phase: 2
title: "TUI, CLI, i18n, and docs"
status: pending
priority: P1
effort: 1.5h
dependencies: [1]
---

# Phase 2: TUI, CLI, i18n, and docs

## Goal

Ask for an identity before the first VPS SSH in the TUI, accept `--identity` on CLI, and thread that choice through install and update.

## Context

- Shared entry: `selectVpsHost` in `bin/agentkit-helper.mjs` (used by install and update scope).
- Probe happens immediately after host trim; identity must be chosen **before** `probeRemoteVps(host)`.
- CLI `--ssh` without TTY currently uses BatchMode and default SSH identities. Keep that when `--identity` is omitted.
- `parseArgs` has no identity flag. `--ssh` is valid only with install/update.
- Printed remote plan currently writes `ssh ${sshTarget}` rather than `formatSshCommand`.

## Requirements

- [x] After a host is chosen, TUI `choose` lists: detected files (basename + path), “Use SSH default (agent/config)”, “+ Enter identity path…”, “Password”
- [x] Empty `~/.ssh` still shows default / enter path / password
- [x] Selected file or entered path is passed as `identityFile` on every SSH for that session
- [x] “SSH default” passes neither `identityFile` nor `passwordOnly`
- [x] “Password” sets `passwordOnly: true`
- [x] CLI `--identity <path>` on install/update with `--ssh`; error if used without `--ssh` or if the path is empty
- [x] `--yes` + `--identity` still uses BatchMode (passphrase-less key or agent-unlocked key)
- [x] `--yes` + password-only is not a CLI mode; password is TUI-only
- [x] EN + VI strings; `usage()` and README / README.vi mention `--identity`
- [x] Integration: fake ssh log contains `-i` and `IdentitiesOnly=yes` when `--identity` is set

## Architecture

```
selectVpsHost
  host → selectVpsAuth (detect + choose)
       → probeRemoteVps(host, { identityFile, passwordOnly })
       → bootstrapRemoteAk(host, { identityFile, passwordOnly })
return { host, probe, identityFile, passwordOnly }

selectScope / executeRemoteInstall / executeRemoteUpdate
  thread those fields into every runSsh / probeRemoteVps
```

CLI: `commandOptions.identityFile` from `--identity`. When `options.sshTarget` is already set, skip TUI picker and use that path (or default if unset).

## Related files

- Modify: `/home/dev/projects/agentkit-helper/bin/agentkit-helper.mjs`
- Modify: `/home/dev/projects/agentkit-helper/lib/args.mjs`
- Modify: `/home/dev/projects/agentkit-helper/lib/i18n.mjs`
- Modify: `/home/dev/projects/agentkit-helper/test/args.test.mjs`
- Modify: `/home/dev/projects/agentkit-helper/test/i18n.test.mjs`
- Modify: `/home/dev/projects/agentkit-helper/test/cli.integration.test.mjs`
- Modify: `/home/dev/projects/agentkit-helper/README.md`
- Modify: `/home/dev/projects/agentkit-helper/README.vi.md`

## Implementation Steps

1. Add i18n keys (both locales): `vpsIdentityPrompt`, `vpsIdentityDefault`, `vpsIdentityPassword`, `vpsIdentityEnterPath`, `vpsIdentityPathPrompt`. Optional `vpsIdentityNoneFound` if the list is empty.
2. Parse `--identity`; validate it is only legal with `--ssh` / `--vps`. Store as `options.identityFile`.
3. In `selectVpsHost`, after host is non-empty and before probe, if stdin/stdout are TTY and no `commandOptions.identityFile`, prompt. Resolve `identityFile` / `passwordOnly`. Pass into `probeRemoteVps` and `bootstrapRemoteAk`.
4. Put `{ identityFile, passwordOnly }` on the scope object. `executeRemoteInstall` and `executeRemoteUpdate` must use them on probe (when `scope.probe` is missing), bootstrap, and every `runSsh`. Prefer `commandOptions.identityFile` when scope has none.
5. Print remote commands with `formatSshCommand` so `-i` is visible in the plan.
6. Tests: parse `--identity`; reject `--identity` without `--ssh`; i18n strings exist in en/vi; one `runCli` install `--ssh --identity <tmpfile> --yes` asserts fake-ssh argv includes `-i` and `IdentitiesOnly=yes` on probe and install.
7. README advanced CLI: `--identity ~/.ssh/id_ed25519` next to `--ssh` examples.

## Todo

- [x] i18n keys en/vi
- [x] `--identity` in `parseArgs` / `usage()`
- [x] TUI picker in `selectVpsHost` before probe
- [x] Thread auth through install and update SSH calls
- [x] Show identity in printed SSH plan
- [x] args, i18n, and CLI integration tests
- [x] README.md and README.vi.md

## Success Criteria

- Interactive VPS flow cannot reach probe without an auth choice (default, file, path, or password)
- `akh install --ssh user@host --identity /tmp/id --kit engineer --runtime codex --yes` records `-i /tmp/id` on both SSH calls
- Omitting `--identity` keeps today’s argv (no `-i`)
- Help text and READMEs document `--identity`

## Verification

```bash
npm test
```

Manual TUI (when a real `~/.ssh` exists): Install a Kit → Remote VPS → host → identity list appears → Esc still returns to scope.

## Risk Assessment

- Forgetting one `runSsh` site (force-retry install, bootstrap, second probe) would still password-prompt. Audit every `runSsh` / `probeRemoteVps` / `bootstrapRemoteAk` in `bin/agentkit-helper.mjs`.
- Relative `--identity` paths should resolve against `process.cwd()` once and pass the absolute path to ssh.
- BatchMode + encrypted key will fail closed; that is intended for `--yes`.

## Security Considerations

- Do not echo the private key. Labels may show the file path.
- Do not write the chosen path into `config.json` (non-goal).
- Password mode disables pubkey so OpenSSH does not burn `MaxAuthTries` on the wrong keys.

## Next Steps

`/ak:cook plans/260911-0659-vps-ssh-identity-picker/plan.md`
