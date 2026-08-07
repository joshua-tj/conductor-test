# RepoSentry

RepoSentry is a compact full-stack GitHub library security auditor. Submit a public repository URL and the Node API creates a Conductor cloud workspace running Codex (`gpt-5.6-sol`), sends a static-analysis-only security brief, monitors the session, and stores the complete transcript in SQLite. The React UI polls the local API and renders the final report as safe Markdown.

## Architecture

- **Frontend:** React, Vite, TypeScript, Tailwind CSS, Valtio state in `src/state.ts`, and `react-markdown` with raw HTML disabled.
- **Backend:** Hono on Node, with a small Conductor HTTP client and durable polling monitor.
- **Persistence:** Node's built-in SQLite driver. Schema initialization runs on startup; normalized repository URLs have a unique constraint.
- **Recovery:** queued/running rows are resumed on server startup. A database lease prevents duplicate monitors from launching the same row under normal concurrent operation.

The browser only calls `/api`; Conductor credentials remain in the server environment.

## Local setup

Requires Node.js 22.13 or newer.

```bash
cp .env.example .env
# Fill in CONDUCTOR_API_KEY in .env, then export it or use your preferred env loader.
npm install
set -a && source .env && set +a
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Hono server on port `8787`. Conductor local workspaces use their allocated `CONDUCTOR_PORT` for Vite and the next port for the API, allowing concurrent workspaces. In production, `npm run build && npm start` serves the compiled UI and API together on `PORT`.

Conductor cloud workspaces already provide `CONDUCTOR_API_URL` and typically a scoped `CONDUCTOR_API_KEY`/`CONDUCTOR_API_TOKEN`; `CONDUCTOR_SESSION_ID`, when present, is sent for request attribution.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CONDUCTOR_API_URL` | Yes | — | API origin, with or without `/v0` |
| `CONDUCTOR_API_KEY` | Yes* | — | Server-only bearer credential |
| `CONDUCTOR_API_TOKEN` | Yes* | — | Fallback cloud workspace token |
| `CONDUCTOR_SESSION_ID` | No | — | Request attribution header |
| `DATABASE_PATH` | No | `./data/audits.db` | SQLite file |
| `PORT` | No | `8787` | Production/API port |
| `AUDIT_POLL_INTERVAL_MS` | No | `5000` | Conductor polling interval |
| `AUDIT_RETRY_BASE_MS` | No | `500` | Exponential retry base delay |
| `AUDIT_REQUEST_RETRIES` | No | `3` | Retries per transient API request |
| `AUDIT_REQUEST_TIMEOUT_MS` | No | `30000` | Timeout for each Conductor request |
| `AUDIT_MAX_POLL_ERRORS` | No | `8` | Failed polling cycles before failure |
| `AUDIT_MAX_DURATION_MS` | No | `7200000` | Maximum wall time for an audit |

\* `CONDUCTOR_API_KEY` takes precedence; one credential is required.

## Commands

```bash
npm run dev        # frontend and API with reload
npm test           # isolated tests; never contacts Conductor
npm run typecheck  # frontend and backend TypeScript checks
npm run build      # production frontend and server output
npm start          # serve production build
```

## API and caching flow

`POST /api/audits` accepts `{ "repositoryUrl": "https://github.com/owner/repo" }`. The server rejects non-HTTPS URLs, credentials, query strings, fragments, non-GitHub hosts, and paths other than exactly `owner/repo`; trailing `/` and `.git` are normalized away.

SQLite uniqueness makes submission idempotent, including URL case differences. An existing completed row is returned with `cached: true` and no workspace launch. An existing queued/running row is returned as-is. A new row is returned as `202`, launched in the background, and can be polled at `GET /api/audits/:id` until `completed` or `failed`.

The monitor reads messages incrementally, waits until it observes `working` before treating a later `idle` as complete (with the documented fast-response transcript fallback), and fetches the final paginated transcript before completion.

## Security and limitations

- Repository URLs and transcripts are untrusted. URLs are never passed to a shell. Markdown raw HTML and remote images are disabled, links use safe renderer defaults plus `noopener`, and the app sends restrictive security headers.
- The audit prompt explicitly forbids installs, builds, lifecycle scripts, tests, binaries, and downloaded payload execution. This is an instruction to an automated agent, not a sandbox policy proof.
- Results can contain false positives and false negatives and are not a guarantee of safety or a replacement for expert review, dynamic analysis, dependency intelligence, or secret rotation.
- A durable lease handles restarts and ordinary concurrency. Because workspace creation currently has no public idempotency key, a process crash after Conductor accepts creation but before SQLite records its response can theoretically orphan a workspace.
- Completed audits are intentionally immutable by normalized URL. Delete the local database row manually if a fresh audit of a changed repository is required.
- This mini app has no user authentication or distributed rate limiter. Add both before exposing workspace creation on a public deployment.
