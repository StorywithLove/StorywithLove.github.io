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
- GitHub commits are the source baseline. Cloud and local checkouts are working
  copies, not independent baselines.

## Default and fallback execution environments

- Default to a repository-first Codex Cloud workflow. Select the relevant
  repository and an up-to-date `main` commit, let Codex create an ephemeral
  cloud checkout, and perform the scoped changes and checks there.
- A cloud checkout is disposable. Publish its work through a task branch and
  pull request; never treat unpushed cloud state as a source baseline.
- If Codex Cloud is unavailable, unsuitable for a required local integration,
  or cannot reproduce the project environment, use the local fallback workflow:
  update a safe working copy, create the same task branch, make and test the
  change locally, then push it through the same pull-request and CI gates.
- The execution environment may change, but branch naming, tests, review, CI,
  merge, deployment, and verification requirements do not.

## Persistent frontend mirror and local fallback

- This frontend repository root is the only persistent local project checkout.
  It is the normal VS Code/Codex local entrypoint and a synchronized mirror of
  the frontend GitHub repository, not the source baseline.
- If it is absent, clone the frontend repository into the intended workspace
  path and use that clone as the task entrypoint.
- If the local fallback is needed, do not clone over this checkout. Inspect
  `git status`, preserve user changes, run `git fetch --prune origin`, and update
  a clean local `main` with `git pull --ff-only origin main` before branching.
- If the checkout is dirty or has diverged, do not overwrite, reset, or silently
  merge it. Reconcile the existing work first or ask the user.
- Codex Cloud backend work does not require a local backend checkout. If the
  local fallback is needed, create a temporary clone of the private backend
  repository, use it only for that task, and do not create a persistent backend
  baseline. Remove only the temporary checkout created for the task after its
  branch is safely pushed and merged.

## Change workflow

1. Use Codex Cloud by default. Fall back to a safe local checkout when cloud
   execution is unavailable or unsuitable.
2. Start from an up-to-date `main` commit in the selected environment.
3. Create a task branch named `agent/<short-description>`. Do not develop or
   commit directly on `main`.
4. Make only task-scoped changes and keep frontend and backend changes in their
   respective repositories and pull requests.
5. Run the relevant checks in the cloud or local working copy before publishing.
6. Push the task branch and open a pull request targeting `main`.
7. Review the diff and merge only after the repository CI checks pass.
8. Treat the merged GitHub commit as the new source baseline.

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

- After a frontend `main` deployment reaches a terminal result, synchronize the
  persistent frontend mirror: switch it back to `main`, run
  `git fetch --prune origin`, then `git pull --ff-only origin main`.
- If the Pages deployment failed, keep the local mirror synchronized with the
  GitHub source baseline but report clearly that production did not advance to
  that commit.
- Confirm the persistent checkout is clean and matches `origin/main`.
- A pushed branch or unmerged pull request is not final synchronization; report
  it explicitly as pending.
