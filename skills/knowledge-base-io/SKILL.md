---
name: knowledge-base-io
description: Use this skill when an agent needs to normalize article-like content before ingest, send cleaned documents into the local knowledge-base service, or query the service through its search and ask endpoints. It defines filtering rules for noisy transcript-style text plus the exact HTTP interface contract for ingest, retrieval, and debug validation.
---

# Knowledge Base IO

Use this skill when working with the repo-local knowledge base service on `http://127.0.0.1:8777`.

This skill is for:

- normalizing raw article, transcript, or note content before ingest
- filtering source material through an upstream agent before ingest
- constructing valid payloads for `POST /documents`
- calling `GET /knowledge/search` and `POST /knowledge/ask`
- validating grouped search results and debug raw results

This skill is not for:

- editing the backend service implementation
- free-form summarization without storing or querying through the service
- ad hoc prompting that ignores the knowledge-base API contract

## Required Workflow

1. Decide whether the task is ingest, search, ask, or debug validation.
2. On ingest flows, use an upstream agent to filter and normalize the source first.
3. Keep the cleaned source body as `rawContent`; do not replace it with a summary.
4. Use the exact HTTP contract from [api-contract.md](references/api-contract.md).
5. Let the backend perform final knowledge extraction and structuring before persistence.
6. Prefer grouped search results from `/knowledge/search`.
7. Use `raw=1` only on debug flows when chunk-level inspection is needed.

## Two-Stage Ingest Model

The intended ingest path is:

1. Upstream agent filters the material.
2. Upstream agent outputs a clean, schema-valid payload.
3. Backend receives the cleaned document.
4. Backend uses its LlamaIndex/LLM extraction step to produce the final stored summary, cards, and optional annotations.

Responsibilities:

- upstream agent:
  - remove transport noise and wrapper text
  - split multi-document blobs into separate documents
  - preserve real source wording and section structure
  - optionally attach explicit human annotations
- backend:
  - perform final extraction from cleaned source text
  - create reusable knowledge cards
  - create annotations only when there is a real follow-up signal
  - persist canonical document and rebuild the index

## Input Normalization

Before ingest, apply these rules:

- keep the true article or transcript body
- keep the user-supplied title if available
- use the upstream agent to discard irrelevant or low-signal fragments before ingest
- remove transport noise such as `技能执行成功`, `现在让我总结`, `太好了`, or other wrapper phrases that describe the extraction process rather than the source content
- remove obvious separator lines such as long repeated `---` or `//-----` blocks unless they separate independent articles
- if multiple articles exist in one file, split them first and ingest them as separate documents
- preserve substantive bullet points, section headings, and framework or tool names
- do not paraphrase the source before ingest; store cleaned source text

## Ingest Contract

Preferred payload:

```json
{
  "title": "explicit document title",
  "sourceType": "note",
  "sourceUrl": "",
  "rawContent": "cleaned source text",
  "annotations": [
    {
      "note": "optional human signal",
      "signalType": "use_later"
    }
  ],
  "autoExtract": true
}
```

Rules:

- always send `title`
- always send cleaned `rawContent`
- use `sourceType` from `note | article | video | chat`
- keep `autoExtract=true` when the backend should perform the final LlamaIndex/LLM structuring step
- set `autoExtract=false` only for intentional raw-only storage or controlled debugging
- use `annotations` only for explicit human follow-up signals, not for repeating the summary
- do not stuff model-generated summaries into `annotations`
- if the upstream agent already extracted tentative bullets, keep them in the cleaned source text or pass them as `knowledgeCards`, but still treat backend extraction as the final canonical pass

## Upstream Agent Export Template

Use this template for the upstream agent that prepares content before sending it to the knowledge-base backend.

Required behavior:

- only pass through material that is worth storing for later retrieval
- drop chatty wrappers, operator narration, extraction logs, and duplicated filler
- if the content blob contains multiple unrelated sources, split them into separate payloads
- keep the cleaned body close to the original wording
- do not replace the source body with an upstream summary
- use `annotations` only for explicit human signals or clear follow-up reminders
- default to `autoExtract=true` so the backend performs the final canonical extraction pass

Recommended upstream prompt:

```text
You are the upstream ingest filter for the local knowledge base.

Your job is not to do the final knowledge extraction.
Your job is to decide what is worth storing, remove noise, and output a clean ingest payload for the backend.

Output exactly one JSON object with this shape:
{
  "title": "document title",
  "sourceType": "note",
  "sourceUrl": "",
  "rawContent": "cleaned source body",
  "annotations": [
    {
      "note": "explicit human follow-up signal",
      "signalType": "use_later"
    }
  ],
  "autoExtract": true
}

Rules:
- Only keep content with reusable value: decisions, techniques, experiments, patterns, failures, tradeoffs, or durable references.
- Remove wrapper text, agent narration, extraction logs, and transport noise.
- Preserve the real source wording and structure where possible.
- If the input mixes multiple unrelated documents, split them before output.
- Do not generate knowledge cards here unless explicitly required by the caller.
- Do not summarize the whole document into rawContent.
- annotations must be sparse and only reflect explicit human signals or concrete follow-up items.
- Set sourceType to one of: note, article, video, chat.
- Keep autoExtract=true.
```

Recommended output example:

```json
{
  "title": "GSD and context isolation notes",
  "sourceType": "note",
  "sourceUrl": "",
  "rawContent": "GSD isolates long-running work into fresh sessions and writes durable state to disk. This reduces context rot and makes multi-step coding tasks easier to recover. The notes compare this with chat-thread-heavy workflows that keep too much transient state in memory.",
  "annotations": [
    {
      "note": "Try this pattern on the next long coding workflow",
      "signalType": "use_later"
    }
  ],
  "autoExtract": true
}
```

## Search Contract

Use grouped document-level search by default:

```text
GET /knowledge/search?q=<query>&topK=5
```

Optional filters:

- `days=1`
- `days=20`
- `createdAfter=2026-04-01T00:00:00Z`
- `raw=1` for debug only

Interpretation:

- `results` is grouped by `documentId`
- `snippet` is the best matched snippet for that document
- `matchedSnippets` contains additional matched snippets
- `matchCount` shows how many raw nodes matched before grouping

## Ask Contract

Ask the knowledge base when the caller wants a synthesized answer:

```json
{
  "query": "针对 AI 的优化我们记录了哪些？",
  "topK": 4
}
```

Use:

```text
POST /knowledge/ask
```

Interpretation:

- `answer` is the LLM-generated response
- `sources` are retrieval sources
- if the service falls back, inspect `mode`

## Debug Mode

Use the debug page or `raw=1` when:

- grouped search results look repetitive or suspicious
- a query seems to miss an expected document
- you need to inspect chunk-level matches
- you need to confirm time filters such as `days` or `createdAfter`

## Operator Defaults

- base URL: `http://127.0.0.1:8777`
- main search page: `/`
- debug page: `/debug`
- health check: `/health`

## References

- API details: [api-contract.md](references/api-contract.md)
