# Contributing

Coding standards and conventions for this project. All agents read this file.

## Language & framework

- **Language:** JavaScript (Node.js ≥16)
- **Framework:** Express 4 (backend); vanilla JS + DOM on the frontend (no build tooling)
- **Package manager:** npm

## Commands

| Action | Command |
|--------|---------|
| Install | `npm ci` |
| Run | `npm start` (`node server.js`) |
| Build | — (interpreted; no compile step) |
| Test | — (no test suite configured yet) |
| Lint | — (no linter configured) |
| Format | — (no formatter configured) |

## Code style

- 2-space indentation, semicolons, single-quoted strings
- CommonJS modules (`require` / `module.exports`) — no ESM, no TypeScript
- `camelCase` for variables and functions; `SCREAMING_SNAKE_CASE` for module-level constants (e.g. `DATA_DIR`, `TRANSCODE_DIR`)
- Vanilla frontend: plain DOM APIs in `public/js/`, no framework or bundler
- Comment the *why*: the codebase favors explanatory comments on non-obvious logic (transcode flow, Range requests, iOS quirks)
- Keep server logic in `server.js`; keep per-page client logic in `public/js/<page>.js`

## File naming

- Lowercase, single-word or hyphenated filenames (`server.js`, `watch.js`, `docker-compose.yml`)
- Client scripts live in `public/js/` named after the page they drive (`watch.js` ↔ watch page)

## Git conventions

- Branch naming: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- Commit messages: imperative mood, descriptive, no generic messages
- Use HEREDOC format for multi-line commit messages
- Co-author trailer: `Co-authored-by: Claude <noreply@anthropic.com>`
- Never force-push. Never use `--no-verify`.
- Stage files explicitly — never `git add .`

## Definition of done

- [ ] Code compiles/builds without errors
- [ ] All existing tests pass
- [ ] New tests cover the change
- [ ] Lint passes with zero warnings
- [ ] No TODO/FIXME introduced without a tracking issue
