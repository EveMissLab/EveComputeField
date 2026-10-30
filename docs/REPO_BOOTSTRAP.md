> Publication update (2026-10-30): the public independent repository now exists at https://github.com/EveMissLab/EveComputeField . Initial `main` is already published. The historical instructions below describe the completed initial bootstrap, not a pending step.

# Publish as a standalone EveMissLab repository

**Target:** `EveMissLab/EveComputeField` — new repository. **Do not use** `evemisslab-project-catalog` or an existing website repository.

The initial ZIP contains an independent GitHub-ready source tree, **not** a live remote repository. Publication requires a GitHub user with permission to create repositories under the `EveMissLab` organization.

## PowerShell (Windows)

Extract the package and run from its `EveComputeField` source directory. Install [Git](https://git-scm.com/) and [GitHub CLI](https://cli.github.com/) first. Then:

```powershell
cd EveComputeField
gh auth login
go test ./...
git init -b main
git add .
git commit -m "feat: bootstrap EveComputeField reference runtime"
gh repo create EveMissLab/EveComputeField --public --description "Local-first virtual compute fields with pluggable execution and LAN-first scheduling" --source . --remote origin --push
```

If the Git repository already exists, do not run `git init` again. If the organization repository exists, **do not overwrite it**; review and reconcile history instead.

## GitHub browser + Git alternative

Create a new empty public repo named `EveComputeField` under the `EveMissLab` organization through GitHub's web interface (do not pre-populate README or license). In the extracted source tree:

```bash
git init -b main
git add .
git commit -m "feat: bootstrap EveComputeField reference runtime"
git remote add origin https://github.com/EveMissLab/EveComputeField.git
git push -u origin main
```

## Release cautions

- Never commit development TLS private keys, state snapshots or access credentials.
- Local evidence means tested with two processes on loopback, **not** with two LAN machines.
- Do not tag stable or claim production status before Windows, real-LAN, security and performance checks.
- The new repo is independent. Existing website/catalog assets remain unchanged.
