---
name: review-engine
description: Run a fast local interview review loop with JSON-backed cards, spaced repetition, weak-point memory, and explicit user scoring.
---

# Review Engine

Use this skill for the local self-hosted review engine. It replaces the old Anki gateway flow.

Primary entrypoint:

- `bash skills/review-engine/scripts/review_engine.sh health`
- `bash skills/review-engine/scripts/review_engine.sh decks`
- `bash skills/review-engine/scripts/review_engine.sh stats --deck "Graphics Engine Interview"`
- `bash skills/review-engine/scripts/review_engine.sh open-review --deck "Graphics Engine Interview"`
- `bash skills/review-engine/scripts/review_engine.sh review-prompt`
- `bash skills/review-engine/scripts/review_engine.sh review-next`
- `bash skills/review-engine/scripts/review_engine.sh interview-log ...`
- `bash skills/review-engine/scripts/review_engine.sh candidate-list --status pending`
- `bash skills/review-engine/scripts/review_engine.sh update --card-id "<id>" --front "New Question"`
- `bash skills/review-engine/scripts/review_engine.sh delete --card-id "<id>"`

## Contract

Default base URL:

- `http://127.0.0.1:8776`

Routine commands:

```bash
bash skills/review-engine/scripts/review_engine.sh decks
bash skills/review-engine/scripts/review_engine.sh stats
bash skills/review-engine/scripts/review_engine.sh open-review --deck "Graphics Engine Interview"
bash skills/review-engine/scripts/review_engine.sh open-review --deck "C++ Interview"
bash skills/review-engine/scripts/review_engine.sh open-review --deck "C# Interview"
bash skills/review-engine/scripts/review_engine.sh open-review --deck "Unity Performance Interview"
bash skills/review-engine/scripts/review_engine.sh review-prompt
bash skills/review-engine/scripts/review_engine.sh review-next
bash skills/review-engine/scripts/review_engine.sh candidate-list --status pending
```

Deck selection rule:

- Do not assume `Graphics Engine Interview` unless the user explicitly asked for graphics / rendering / engine questions.
- If the user did not specify a deck, call `decks` or infer from clear wording and ask them which deck they want before opening review.
- Current canonical decks are:
  - `Graphics Engine Interview`
  - `C++ Interview`
  - `C# Interview`
  - `Unity Performance Interview`

## Review Flow

Use this interaction pattern:

1. `review-prompt`
2. Show only `question`
3. Wait for the user's answer
4. Compare the answer against `answer`
5. Reply using:

```text
判断：正确 / 部分正确 / 不正确
问题：<简短指出缺失点>
弱点列表：
- <错点1>
- <错点2>
建议评分：1|2|3|4
请你确认评分，我再写回。
```

6. Before writing a score, always log the evaluation:

```bash
bash skills/review-engine/scripts/review_engine.sh review-log-current \
  --user-answer "<user answer>" \
  --judgment "部分正确" \
  --issues "<brief issues>" \
  --suggested-ease 2 \
  --weak-points "错点1|错点2"
```

7. Only after the user explicitly gives `1|2|3|4`, call:

```bash
bash skills/review-engine/scripts/review_engine.sh review-answer --ease <score>
```

8. If the user says to move on quickly and does not care about the exact score, prefer:

```bash
bash skills/review-engine/scripts/review_engine.sh review-next
```

`review-next` defaults to `2 / Hard` and immediately returns the next card.

## Follow-up Modes

Two follow-up modes are supported:

1. Predefined follow-ups
If a card includes `followups`, `review-prompt` will return them. Use these when you want a prepared interview branch under a main question.

Do not ask all predefined follow-ups blindly. First check whether the user's main answer already covered them:

```bash
bash skills/review-engine/scripts/review_engine.sh followup-select \
  --card-id "<card id>" \
  --user-answer "<main answer>"
```

Only ask the follow-ups in `selected`. If a concept already appears in the main answer, it should land in `covered` and be skipped or only acknowledged briefly.

2. AI-generated candidate cards
If the conversation exposes a stable missing concept, generate one or more candidate cards and write them into the candidate pool. Do not auto-promote them into the main deck until they are approved.

Log an interview session with follow-up QA and optional candidate cards:

```bash
bash skills/review-engine/scripts/review_engine.sh interview-log \
  --card-id "<card id>" \
  --deck "Graphics Engine Interview" \
  --question "<main question>" \
  --answer "<reference answer>" \
  --user-answer "<main answer>" \
  --judgment "部分正确" \
  --issues "<brief issues>" \
  --weak-points "错点1|错点2" \
  --followup-qa-file ./followup_qa.json \
  --candidate-file ./candidate_cards.json
```

Review pending candidate cards:

```bash
bash skills/review-engine/scripts/review_engine.sh candidate-list --status pending
```

Approve candidate cards into the deck:

```bash
bash skills/review-engine/scripts/review_engine.sh candidate-approve --candidate-ids "id1,id2" --deck "Graphics Engine Interview"
```

Recommended follow-up schema inside card JSON:

```json
{
  "question": "为什么 frame graph 能自动推导资源 barrier？",
  "concept": "barrier 推导",
  "coveredSignals": ["barrier", "状态转换", "资源状态", "读写依赖"],
  "tags": ["followup", "barrier"]
}
```

Use `coveredSignals` or `whenMissingAny` so follow-up selection can skip concepts that the user already explained in the first answer.

## Rules

- Use shell mode only.
- Do not use the old `anki-gateway` skill.
- Do not auto-score unless the user explicitly asks for that behavior.
- Do not skip `review-log-current` after giving answer feedback.
- Keep `weakPoints` stable across attempts so the same weakness accumulates.
- Prefer `review-prompt` over any raw full-card debug route.

## Cards

Search:

```bash
bash skills/review-engine/scripts/review_engine.sh search --query "draw call" --limit 5
```

Add:

```bash
bash skills/review-engine/scripts/review_engine.sh add \
  --deck "Graphics Engine Interview" \
  --front "Question" \
  --back "Answer" \
  --tags "graphics-engine,interview"
```

Batch import:

```bash
bash skills/review-engine/scripts/review_engine.sh add-json --file ./data/review-engine/examples/graphics-engine-interview.sample.json
```

Update:

```bash
bash skills/review-engine/scripts/review_engine.sh update \
  --card-id "<id>" \
  --deck "C++ Interview" \
  --front "New Question" \
  --back "New Answer" \
  --tags "cpp,layer-1-foundation"
```

Delete:

```bash
bash skills/review-engine/scripts/review_engine.sh delete --card-id "<id>"
```

Editing contract:

- `update` keeps the same `cardId`, so review scheduling and weak-point memory remain attached.
- `update` also syncs denormalized fields stored in review history and interview session logs by default.
- `delete` removes the live card and its scheduling state, clears the active session pointer if needed, and marks matching history/session entries as deleted provenance instead of erasing them.
