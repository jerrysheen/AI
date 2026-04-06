# Review Engine

This service is a local JSON-backed review engine designed for fast AI-assisted interview practice.

Goals:

- keep spaced repetition behavior
- avoid GUI-driven Anki latency
- support weak-point memory and local history
- let the user keep final control over scoring

Runtime:

- server: `python3 -m src.review_engine.server`
- default URL: `http://127.0.0.1:8776`
- start script: `./scripts/start_review_engine.sh`

Data layout:

- cards: `data/review-engine/cache/cards.json`
- state: `data/review-engine/runs/state.json`
- history: `data/review-engine/runs/review-history.jsonl`

By default these files are intended to be checked into Git so review content, progress, and local answer history can sync through your repository.

Core endpoints:

- `GET /health`
- `GET /decks`
- `GET /stats`
- `POST /review/open`
- `GET /review/prompt`
- `POST /review/log`
- `POST /review/answer`
- `POST /review/next`
- `GET /review/history`
- `GET /cards/search`
- `POST /cards`
- `POST /cards/batch`
- `PATCH /cards/:id`

Current review decks:

- `Graphics Engine Interview`
- `C++ Interview`
- `C# Interview`
- `Unity Performance Interview`

Recommended UX behavior:

- If the user says `anki复习` / `开始复习` without naming a deck, ask which deck they want first.
- Do not default to `Graphics Engine Interview` unless the user explicitly asked for graphics / rendering / engine review.
