# StorywithLove system workspace instructions

## System topology and source of truth

- System homepage and frontend production:
  `https://storywithlove.github.io/`.
- Frontend source baseline:
  `https://github.com/StorywithLove/storywithlove.github.io`, branch `main`.
- Backend source baseline:
  `https://github.com/StorywithLove/pv-forecast-backend`, branch `main`.
  The backend repository is private.
- Frontend deployment: GitHub Pages through the repository's Pages workflow.
- Backend deployment: OCI under `/data/pv-forecast`.
  `/data/pv-forecast/releases`, `current`, `shared`, deployment locks, history,
  virtual environments, and runtime secrets are server state and must not be
  committed or synchronized to GitHub.
- GitHub commits are the source baseline. A local checkout is a disposable
  working copy, not an independent baseline or backup.

## Persistent local workspace

- This repository root is the only persistent local project checkout and is the
  normal Codex entrypoint.
- If it is absent, clone the frontend repository into the intended workspace
  path and use that clone as the task entrypoint.
- If it exists, do not clone over it. Before work, inspect `git status`, preserve
  user changes, run `git fetch --prune origin`, and update a clean local `main`
  with `git pull --ff-only origin main`.
- If the checkout is dirty or has diverged, do not overwrite, reset, or silently
  merge it. Reconcile the existing work first or ask the user.
- Backend work should use a temporary clone of the private backend repository.
  Do not create a second persistent backend baseline. Remove only the temporary
  checkout created for the task after its branch is safely pushed and merged.

## Change workflow

1. Start from an up-to-date `main`.
2. Create a task branch named `agent/<short-description>`. Do not develop or
   commit directly on `main`.
3. Make only task-scoped changes and keep frontend and backend changes in their
   respective repositories and pull requests.
4. Run the relevant local checks before publishing.
5. Push the task branch and open a pull request targeting `main`.
6. Merge only after the repository CI checks pass.
7. Treat the merged GitHub commit as the new source baseline.

Frontend checks:

```powershell
npm.cmd test
npm.cmd run security:check
npm.cmd run api:check
```

Run the live API check when the change affects API use, deployment, CORS, data
adapters, or the Agent. A transient external-service failure must be diagnosed,
not bypassed.

Backend checks must use the repository's documented Python environment. On
managed Codex machines, follow the machine-level Python instructions and invoke
that environment's interpreter explicitly:

```text
<pv-forecast-environment-python> -m unittest discover -s tests -q
```

Follow any more specific `AGENTS.md` inside the backend repository.

## Deployment verification

- Merging frontend `main` triggers GitHub Pages deployment. Verify that the
  successful Pages deployment references the merged commit and that production
  assets match the build.
- Merging backend `main` updates the backend source baseline but does not by
  itself authorize or perform an OCI deployment.
- An authorized OCI deployment must use
  `/data/pv-forecast/.venv/bin/python deploy/release_manager.py deploy
  origin/main`. It builds a tested immutable release, atomically switches
  `current`, and rolls back on failed health checks.
- After an OCI deployment, verify `/api/v1/status`, including `build_commit`,
  against the merged backend commit and verify the GitHub Deployment environment
  `production-oci`.
- Never copy OCI `releases/`, `current`, `shared/`, `.env`, credentials, or
  virtual environments back into either GitHub repository.

## End-of-task synchronization

- After the frontend pull request is merged, switch the persistent checkout back
  to `main`, run `git fetch --prune origin`, then
  `git pull --ff-only origin main`.
- Confirm the persistent checkout is clean and matches `origin/main`.
- A pushed branch or unmerged pull request is not final synchronization; report
  it explicitly as pending.
