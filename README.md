# AgentKit Helper

[Tiếng Việt](./README.vi.md)

A friendly TUI for installing and updating AgentKit Kits. It detects your
`ak` binary, asks a few questions, shows the official command, and runs it for
you.

![AgentKit Helper TUI](./assets/tui-preview.en.svg)

## Start

Requires Node.js 20.12+ and the `ak` CLI.

```bash
npx --yes @thieung/agentkit-helper
```

For the shorter `akh` command:

```bash
npm install --global @thieung/agentkit-helper
akh
```

In the TUI, use:

- ↑/↓ to navigate
- Space to select multiple runtimes
- Enter to confirm
- Esc to return to the previous step

The TUI has two main actions: **Update** and **Install a Kit**. Update detects
the `ak` binary, global Kits, and this project's Kits when AgentKit owns the
current directory. Install asks for project or user/global scope, Engineer or
Marketing Kit, runtimes, and Stable or Beta. **More** hides export, doctor, and
update-all. When the current directory is a safe project path (not `/` or your
home directory), Install offers **Use current project**; the equivalent CLI
flag is `--project .`. AgentKit remains responsible for Kit verification,
ownership, snapshots, and runtime-specific files.

For global install, the helper first runs without `--force`. If the target
already exists or drift is detected, the TUI shows a WARNING and asks for
separate consent, defaulting to No. It retries with `--force` only after you
choose Yes. Global update is preserve-only: user-modified files are skipped
and the helper never adds `--force`.

Platform status: macOS is verified locally. Linux is a supported target for the
portable Node.js path. Native Windows PowerShell support is experimental until
it passes a real-machine smoke test; the repository includes Windows-oriented
command handling and CI coverage, but does not yet claim provider-backed E2E
verification.

Windows smoke checklist (manual; keep experimental until this passes on a real
machine):

1. Install `ak` with `irm https://agentkit.best/install.ps1 | iex`, then open a
   new terminal.
2. Run `npx --yes @thieung/agentkit-helper` (or `akh` after a global npm install).
3. In the TUI, choose **Install a Kit**, then **Use current project** (or
   `akh install --project .`).
4. Install one runtime, then run `akh update`.

<details>
<summary><strong>Advanced CLI usage</strong></summary>

Install into a project:

```bash
akh install --project /path/to/project --kit engineer \
  --runtime codex --channel stable
```

Install into runtime user/global scope:

```bash
akh install --global --kit engineer \
  --runtime codex,omp,pi --channel stable
```

Install into a remote Linux VPS via SSH:

```bash
akh install --ssh user@host --kit engineer \
  --runtime codex --channel stable
```

Update Kits on a remote Linux VPS via SSH:

```bash
akh update --ssh user@host
akh update --ssh user@host --runtime codex
```

`--ssh <host>` (alias `--vps`) targets a remote Linux VPS over system SSH. It implies `--global`, checks the remote `ak` binary, discovers remote kit installations via a single probe, fail-closes if a requested runtime is missing on the remote host, and persists recent hosts in `~/.agentkit-helper/config.json`. If `ak` is not yet installed on the VPS, interactive mode offers to bootstrap it automatically via the official installer.

Update:

```bash
akh update
akh update --project /path/to/project
akh update --all --channel stable
akh update --dry-run
```

`akh update` uses the channel of the installed `ak` binary unless `--channel`
is set. From `/` or your home directory it updates that binary and **every
globally installed runtime** it detects (`claude-code`, `codex`, `cursor`,
`dsh`, `grok`, `omp`, `pi`, plus `pi-ak`/`pi-omp` profiles when present). From
an AgentKit-owned project it also updates that project's Kits. CLI one-shot
applies immediately; `akh update --dry-run` previews only. `akh update --all`
adds registered projects and optional deep scan.

Runtimes: `claude-code`, `codex`, `cursor`, `dsh`, `grok`, `omp`, `pi`, `pi-ak`, `pi-omp`

`dsh` updates use `ak kit refresh` because remote `ak update` still rejects that runtime. `pi-ak` and `pi-omp` are global-only profile aliases (`--global`); they install/update into the custom Pi/OMP homes instead of the default `pi`/`omp` directories.

Run `akh --help` for every command and option.

</details>

## Development

```bash
npm ci
npm run check
npm test
```

MIT License
