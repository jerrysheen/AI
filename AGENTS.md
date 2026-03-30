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
