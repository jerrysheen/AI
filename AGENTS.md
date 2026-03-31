# Repository Guidelines

## Project Structure & Module Organization
This repository is currently minimal. Use the structure below for all new contributions to keep code discoverable and maintainable:
- `src/`: application/source code grouped by feature or module.
- `tests/`: automated tests mirroring `src/` layout.
- `assets/`: static files (images, sample data, fixtures).
- `docs/`: design notes and architecture decisions.

Example: `src/auth/login.py` should have tests in `tests/auth/test_login.py`.

## Build, Test, and Development Commands
No project-specific toolchain is committed yet. When adding one, expose standard commands and document them in this file.
Recommended baseline:
- `make setup` or equivalent: install dependencies and prepare local env.
- `make test`: run full automated test suite.
- `make lint`: run formatting and lint checks.
- `make run`: start the app locally.

If `make` is not used, provide equivalent `npm`, `pytest`, `dotnet`, or language-native commands.

## Coding Style & Naming Conventions
- Use 4-space indentation unless language conventions require otherwise.
- Prefer clear, descriptive names over abbreviations.
- Naming: `snake_case` for files/functions, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants.
- Keep modules focused; avoid oversized utility files.
- Add and enforce formatter/linter configs early (for example: `prettier`, `eslint`, `black`, `ruff`).

## Testing Guidelines
- Place tests under `tests/` with names like `test_<module>.<ext>`.
- Cover new behavior and important edge cases.
- Aim for meaningful coverage on changed code, not only happy paths.
- Keep tests deterministic; avoid external-network dependencies in unit tests.

## Commit & Pull Request Guidelines
This folder is not currently a Git repository; adopt these conventions once Git is initialized:
- Commit format: `type(scope): short summary` (for example: `feat(auth): add token refresh`).
- Keep commits focused and atomic.
- PRs should include: purpose, key changes, test evidence, and screenshots/logs for UI or behavior changes.
- Link related issues and note follow-up work explicitly.

## Security & Configuration Tips
- Never commit secrets, tokens, or private keys.
- Use environment variables and provide a checked-in `.env.example` for required settings.
- Validate third-party dependencies before adding them.

## Shared Runtime Conventions
- Prefer repository-relative defaults so skills remain portable across machines.
- Shared runtime configuration is injected through environment variables, with repo-root `.env` as local developer convenience.
- Current shared variables:
  - `AI_SHARED_DATA_DIR`
  - `AI_CHROME_PROFILE_DIR`
  - `AI_CHROME_DEBUG_PORT`
  - `AI_CHROME_PATH`
  - `AI_CHROME_STARTUP_DELAY_MS`

## Shared Data Layout
- Default shared data root is `.ai-data/` under the repository root unless `AI_SHARED_DATA_DIR` overrides it.
- Keep reusable cross-skill data under:
  - `.ai-data/config/`
  - `.ai-data/cache/`
  - `.ai-data/<source>/runs/`
- Use `runs/` for process artifacts and manifests.
- Use `cache/` for canonical reusable content records that other skills or agents may consume later.
- Group cache data by source, then by date bucket, then by category when possible.

## Shared Browser Rules
- Reuse a shared Chrome debugging session instead of creating per-skill browser sessions.
- Do not hardcode machine-specific Chrome profile paths inside skill logic.
- Chrome settings should resolve from shared environment variables first.

## Watchlists
- Keep source lists outside skill folders.
- Store watchlists under `.ai-data/config/watchlists/`.
- Put time-window defaults in watchlist config rather than hardcoding them into prompts or skill text.
