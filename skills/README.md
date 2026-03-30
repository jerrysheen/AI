# Skills

Repository-local skill source files live under `skills/<skill-name>/`.

Recommended layout:

- `skills/<skill-name>/SKILL.md`
- `skills/<skill-name>/scripts/`
- `skills/<skill-name>/docs/`
- `skills/<skill-name>/config/`
- `skills/<skill-name>/schemas/`
- `skills/<skill-name>/references/`
- `skills/<skill-name>/assets/`

Each skill should stay self-contained. Avoid spreading one skill's scripts, config, and docs across top-level repository folders unless those files are intentionally shared.

This directory is for source management inside the repository. If a skill later needs to be installed for Codex or another CLI, copy the skill directory into that tool's runtime skill location.
