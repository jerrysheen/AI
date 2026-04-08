# API Contract

Base URL:

```text
http://127.0.0.1:8777
```

## Health

```text
GET /health
```

Response highlights:

- `llamaRuntimeReady`
- `llmRuntimeReady`
- `embeddingRuntime.provider`
- `embeddingRuntime.model`

## Ingest

```text
POST /documents
Content-Type: application/json
```

Body:

```json
{
  "title": "LangChain vs LlamaIndex (2025)",
  "sourceType": "note",
  "sourceUrl": "",
  "rawContent": "cleaned transcript or article text",
  "annotations": [
    {
      "note": "LlamaIndex is strong for RAG prototyping",
      "signalType": "use_later"
    }
  ],
  "autoExtract": true
}
```

Important response fields:

- `document.id`
- `document.aiSummary`
- `document.knowledgeCards`
- `document.annotations`
- `extractionWarning`
- `reindexWarning`

## Document Read

```text
GET /documents?limit=10
GET /documents/view?id=<documentId>
```

Use these endpoints to inspect stored documents and extracted cards.

## Search

```text
GET /knowledge/search?q=<query>&topK=5
```

Optional query params:

- `topK`
- `days`
- `createdAfter`
- `raw=1`

Grouped result shape:

```json
{
  "documentId": 3,
  "title": "LangChain vs LlamaIndex (2025)",
  "sourceType": "note",
  "sourceUrl": "",
  "score": 0.56,
  "snippet": "best matched snippet",
  "matchedSnippets": [
    "best matched snippet",
    "second matched snippet"
  ],
  "matchCount": 3,
  "createdAt": "2026-04-08T08:14:08+00:00"
}
```

When `raw=1` is provided, the response also contains `rawResults`, which are raw node-level matches before grouping.

## Ask

```text
POST /knowledge/ask
Content-Type: application/json
```

Body:

```json
{
  "query": "针对 AI 的优化我们记录了哪些？",
  "topK": 4
}
```

Response highlights:

- `mode`
- `answer`
- `sources`

## Recommended Query Patterns

Use framework names, task intent, and decision phrases.

Examples:

- `LangChain LlamaIndex`
- `RAG framework quick prototype`
- `Superpowers GSD gstack`
- `context rot`
- `AI 优化`
- `复杂 AI 工作流 多代理系统`
