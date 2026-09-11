---
phase: 1
title: "Identity discovery and SSH plumbing"
status: pending
priority: P1
effort: 1.5h
dependencies: []
---

# Phase 1: Identity discovery and SSH plumbing

## Goal

Add a pure helper that lists local SSH private keys, and extend `sshInvocationArgs` so every remote call can pin an identity file or force password auth.

## Context

- Brainstorm contract: picker **before** probe (approach A). Reactive picker after password failure is rejected.
- Today `sshInvocationArgs` in `lib/commands.mjs` only adds `BatchMode=yes` + `ConnectTimeout=10`. Host is passed as `ssh -- <host> <bash -lc …>`.
- Callers: `runSsh` / `runSshCapture` (`lib/runner.mjs`), `probeRemoteVps` (`lib/discovery.mjs`), `bootstrapRemoteAk` (`lib/runner.mjs`).
- Do not change `remoteProbeSnippet` or VPS global-only rules.

## Requirements

- [x] `listSshIdentityFiles({ home })` returns absolute paths of private keys under `{home}/.ssh`
- [x] Skip `config`, `known_hosts`, `known_hosts.old`, `authorized_keys`, `authorized_keys2`, `environment`, `*.pub`, directories, and symlinks
- [x] Include well-known names (`id_ed25519`, `id_ed25519_sk`, `id_ecdsa`, `id_ecdsa_sk`, `id_rsa`, `id_dsa`) and other regular files whose first line matches `-----BEGIN .*PRIVATE KEY-----`
- [x] Read at most the first line for sniffing; never log or return key bodies
- [x] `sshInvocationArgs` accepts `{ identityFile, passwordOnly }` and is mutually exclusive
- [x] Identity: `-i <path> -o IdentitiesOnly=yes` before BatchMode/`--`
- [x] Password-only: `-o PreferredAuthentications=keyboard-interactive,password -o PubkeyAuthentication=no`
- [x] Neither set → argv unchanged from today

## Architecture

New `lib/ssh-identity.mjs` (small, testable, no SSH spawn). `sshInvocationArgs` stays the single argv builder. Runner/discovery gain an options pass-through only; TUI wiring is phase 2.

```
listSshIdentityFiles(home)
        │
        ▼
sshInvocationArgs(host, script, { batchMode, identityFile, passwordOnly })
        │
        ▼
runSsh / runSshCapture / probeRemoteVps / bootstrapRemoteAk
```

## Related files

- Create: `/home/dev/projects/agentkit-helper/lib/ssh-identity.mjs`
- Create: `/home/dev/projects/agentkit-helper/test/ssh-identity.test.mjs`
- Modify: `/home/dev/projects/agentkit-helper/lib/commands.mjs`
- Modify: `/home/dev/projects/agentkit-helper/lib/runner.mjs`
- Modify: `/home/dev/projects/agentkit-helper/lib/discovery.mjs`
- Modify: `/home/dev/projects/agentkit-helper/test/commands.test.mjs`

## Implementation Steps

1. Implement `listSshIdentityFiles({ home = homedir() })`. If `{home}/.ssh` is missing, return `[]`. Sort well-known names first (ed25519, ecdsa, rsa, dsa), then remaining names alphabetically.
2. Extend `sshInvocationArgs` / `formatSshCommand` with `identityFile` and `passwordOnly`. Throw if both are set. Ignore empty `identityFile`.
3. Thread the same options through `runSsh`, `runSshCapture`, `bootstrapRemoteAk`, and `probeRemoteVps` without changing default behavior.
4. Add unit tests with a temp `home/.ssh` fixture (keys, junk files, `.pub`, symlink). Assert argv slices for identity, password-only, batch+identity, and default.

## Todo

- [x] Create `lib/ssh-identity.mjs` with skip list and first-line sniff
- [x] Extend `sshInvocationArgs` and `formatSshCommand`
- [x] Pass options through runner and `probeRemoteVps`
- [x] Tests in `test/ssh-identity.test.mjs` and `test/commands.test.mjs`

## Success Criteria

- `listSshIdentityFiles` on a fixture home returns only private keys, never `.pub` / `config` / `known_hosts`
- `sshInvocationArgs("user@vps", script, { identityFile: "/tmp/id_ed25519" })` contains `-i`, `/tmp/id_ed25519`, `IdentitiesOnly=yes`
- Default call still equals `["--", host, remoteCommand]`
- Existing remote CLI integration tests that omit identity still pass (argv prefix remains BatchMode when `--yes`)

## Verification

```bash
node --test test/ssh-identity.test.mjs test/commands.test.mjs
```

## Risk Assessment

- Custom key names without a BEGIN header will not appear; mitigate with “Enter path…” in phase 2.
- Encrypted keys still need an OpenSSH passphrase prompt; that is correct, not a helper password field.
- If both identity and password flags were combined, auth would be undefined; reject at argv build.

## Security Considerations

- Do not print, log, or persist private key contents.
- Do not follow symlinked identity files when scanning (match helper config’s symlink refusal).
- `-i` paths come from the local filesystem listing or an explicit user path, never from remote output.

## Next Steps

Phase 2 wires the TUI/CLI onto this argv contract.
