---
name: knowledge-base-io
description: Use this skill when an agent needs to normalize article-like content before ingest, send cleaned documents into the local knowledge-base service, or query the service through its search and ask endpoints. It defines filtering rules for noisy transcript-style text plus the exact HTTP interface contract for ingest, retrieval, and debug validation.
---

# Knowledge Base IO

Use this skill when working with the repo-local knowledge base service on `http://127.0.0.1:8777`.

This skill is for:

- normalizing raw article, transcript, or note content before ingest
- constructing valid payloads for `POST /documents`
- calling `GET /knowledge/search` and `POST /knowledge/ask`
- validating grouped search results and debug raw results

This skill is not for:

- editing the backend service implementation
- free-form summarization without storing or querying through the service
- ad hoc prompting that ignores the knowledge-base API contract

## Required Workflow

1. Decide whether the task is ingest, search, ask, or debug validation.
2. Normalize the source text before sending it.
3. Use the exact HTTP contract from [api-contract.md](references/api-contract.md).
4. Prefer grouped search results from `/knowledge/search`.
5. Use `raw=1` only on debug flows when chunk-level inspection is needed.

## Input Normalization

Before ingest, apply these rules:

- keep the true article or transcript body
- keep the user-supplied title if available
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
- keep `autoExtract=true` unless intentionally storing raw-only documents
- use `annotations` for explicit human follow-up signals, not for repeating the summary

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
