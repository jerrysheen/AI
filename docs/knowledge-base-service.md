# Knowledge Base Service

## Goal

This service is the repo-local knowledge base for article notes, transcripts, and reusable technical findings.
It stores raw documents, extracted knowledge cards, and user annotations, then builds a local LlamaIndex index for retrieval.

## Folder Layout

```text
F:\AI\
  src\
    knowledge_base\
      __init__.py
      config.py
      json_utils.py
      llama_runtime.py
      server.py
      store.py
  tests\
    knowledge_base\
      test_json_utils.py
      test_store.py
  scripts\
    start-knowledge-base.ps1
    start-knowledge-base.sh
  requirements-knowledge-base.txt
  requirements-hf-cpu.txt
  data\
    knowledge-base\
      db\
        knowledge.db
      index\
      cache\
      uploads\
```

## Runtime Model

- Frontend only talks to this backend.
- The backend stores canonical data in SQLite.
- The backend calls LlamaIndex internally for extraction, vector indexing, retrieval, and QA.
- LlamaIndex is not exposed as a separate service.

## Environment Variables

Add these to `.env`:

```env
AI_KNOWLEDGE_BASE_HOST=127.0.0.1
AI_KNOWLEDGE_BASE_PORT=8777
AI_KNOWLEDGE_BASE_DATA_DIR=data/knowledge-base
AI_KNOWLEDGE_BASE_AUTO_EXTRACT=true
AI_KNOWLEDGE_BASE_OPENAI_API_KEY=
AI_KNOWLEDGE_BASE_OPENAI_BASE_URL=
AI_KNOWLEDGE_BASE_OPENAI_LLM_API_KEY=
AI_KNOWLEDGE_BASE_OPENAI_LLM_BASE_URL=
AI_KNOWLEDGE_BASE_OPENAI_LLM_MODEL=gpt-4.1-mini
AI_KNOWLEDGE_BASE_OPENAI_EMBED_API_KEY=
AI_KNOWLEDGE_BASE_OPENAI_EMBED_BASE_URL=
AI_KNOWLEDGE_BASE_OPENAI_EMBED_MODEL=text-embedding-3-small
AI_KNOWLEDGE_BASE_EMBED_PROVIDER=huggingface
AI_KNOWLEDGE_BASE_HF_EMBED_MODEL=BAAI/bge-small-zh-v1.5
```

`OPENAI_API_KEY` is also supported if you do not want a service-specific key variable.

## Recommended First Run

Use remote LLM plus local embedding:

```env
AI_KNOWLEDGE_BASE_OPENAI_API_KEY=your_api_key
AI_KNOWLEDGE_BASE_OPENAI_BASE_URL=https://your-openai-compatible-endpoint/v1
AI_KNOWLEDGE_BASE_OPENAI_LLM_MODEL=ep-20251217161514-zxd94
AI_KNOWLEDGE_BASE_EMBED_PROVIDER=huggingface
AI_KNOWLEDGE_BASE_HF_EMBED_MODEL=BAAI/bge-small-zh-v1.5
```

This keeps extraction and answer generation on your existing LLM gateway, while retrieval embeddings run locally in Python.
If you provide `AI_KNOWLEDGE_BASE_OPENAI_BASE_URL`, the service uses LlamaIndex's OpenAI-compatible client path instead of strict OpenAI model-name validation.

If LLM and embedding must use different OpenAI-compatible providers, set the split variables instead:

```env
AI_KNOWLEDGE_BASE_OPENAI_LLM_API_KEY=your_llm_key
AI_KNOWLEDGE_BASE_OPENAI_LLM_BASE_URL=https://your-llm-endpoint/v1
AI_KNOWLEDGE_BASE_OPENAI_LLM_MODEL=your-llm-model

AI_KNOWLEDGE_BASE_EMBED_PROVIDER=openai
AI_KNOWLEDGE_BASE_OPENAI_EMBED_API_KEY=your_embed_key
AI_KNOWLEDGE_BASE_OPENAI_EMBED_BASE_URL=https://your-embedding-endpoint/v1
AI_KNOWLEDGE_BASE_OPENAI_EMBED_MODEL=your-embedding-model
```

Priority order:

- LLM key: `AI_KNOWLEDGE_BASE_OPENAI_LLM_API_KEY` -> `AI_KNOWLEDGE_BASE_OPENAI_API_KEY` -> `OPENAI_API_KEY`
- LLM base URL: `AI_KNOWLEDGE_BASE_OPENAI_LLM_BASE_URL` -> `AI_KNOWLEDGE_BASE_OPENAI_BASE_URL` -> `OPENAI_BASE_URL`
- Embedding key: `AI_KNOWLEDGE_BASE_OPENAI_EMBED_API_KEY` -> `AI_KNOWLEDGE_BASE_OPENAI_API_KEY` -> `OPENAI_API_KEY`
- Embedding base URL: `AI_KNOWLEDGE_BASE_OPENAI_EMBED_BASE_URL` -> `AI_KNOWLEDGE_BASE_OPENAI_BASE_URL` -> `OPENAI_BASE_URL`

## Endpoints

### `GET /health`
Checks service state and whether LlamaIndex can run.
It also shows which embedding provider is active.

### `GET /`
Serves the main search page for top-k semantic retrieval results.

### `GET /debug`
Serves the built-in debug console for document ingest, extraction verification, search response inspection, and ask flows.

### `GET /documents?limit=20`
Lists the most recent documents.

### `GET /documents/view?id=1`
Returns one document with cards and annotations.

### `POST /documents`
Creates a document, optionally auto-extracts knowledge, then schedules index rebuild asynchronously.

Example body:

```json
{
  "title": "Three AI coding frameworks",
  "sourceType": "video",
  "sourceUrl": "https://example.com/video",
  "rawContent": "full transcript or article body",
  "autoExtract": true,
  "annotations": [
    {
      "note": "GSD worth trying for context isolation",
      "signalType": "use_later"
    }
  ]
}
```

Response highlights:

- `document`: persisted canonical source payload
- `extractionWarning`: extraction/runtime warning (if extraction is unavailable)
- `extractionDurationMs`: extraction phase duration
- `reindexStatus`: asynchronous reindex state snapshot at submit time

Notes:

- `rawContent` should keep the cleaned source body (not an upstream summary).
- Reindex is no longer a blocking part of this request.

### `POST /documents/delete`
Deletes document records, cascades related knowledge cards and annotations, then schedules index rebuild asynchronously.

Example body:

```json
{
  "id": 123
}
```

You can also delete by title match. By default, title matching deletes only the most recent match:

```json
{
  "title": "龟龟投资框架",
  "match": "contains"
}
```

To delete every matched document instead of just the newest one:

```json
{
  "title": "龟龟投资框架",
  "match": "contains",
  "deleteAll": true
}
```

### `GET /knowledge/search?q=ai优化&topK=5`
Runs semantic retrieval through LlamaIndex. Falls back to SQL keyword search if the runtime is not ready.

Supported query params:

- `q`: required, the search query
- `topK`: optional, grouped document result count
- `raw`: optional, set to `1` to also return raw node-level matches for debugging
- `days`: optional, only keep documents created within the last N days
- `createdAfter`: optional ISO timestamp filter, for example `2026-04-01T00:00:00Z`

Example:

```text
/knowledge/search?q=LlamaIndex&topK=5
/knowledge/search?q=AI优化&topK=5&days=20
/knowledge/search?q=RAG&topK=5&createdAfter=2026-04-01T00:00:00Z
/knowledge/search?q=LangChain&topK=5&days=7&raw=1
```

### `POST /knowledge/ask`
Runs retrieval QA through LlamaIndex.

Example body:

```json
{
  "query": "针对 AI 的优化我们记录了哪些？",
  "topK": 5
}
```

### `POST /knowledge/reindex`
Schedules an async index rebuild from SQLite data.

### `GET /knowledge/reindex/status`
Returns the current reindex state:

- `running`
- `pending`
- `lastError`
- `lastStartedAt`
- `lastFinishedAt`
- `lastDurationMs`
- `lastResult`

## Operator Workflow

1. Create the pinned CPU-only environment:

   ```bash
   python3.11 -m venv .venv-hf-cpu
   TMPDIR="$PWD/.tmp" ./.venv-hf-cpu/bin/python -m pip install -r requirements-knowledge-base.txt
   TMPDIR="$PWD/.tmp" ./.venv-hf-cpu/bin/python -m pip install -r requirements-hf-cpu.txt
   ```
2. Set `OPENAI_API_KEY` or `AI_KNOWLEDGE_BASE_OPENAI_API_KEY`.
3. Start the service with `./scripts/start-knowledge-base.sh` on macOS/Linux, or `.\scripts\start-knowledge-base.ps1` on Windows.
4. Push a document into `POST /documents`.
5. Query via `GET /knowledge/search` or `POST /knowledge/ask`.

## Notes

- `AI_KNOWLEDGE_BASE_OPENAI_LLM_MODEL` is used for extraction and final answers.
- `AI_KNOWLEDGE_BASE_EMBED_PROVIDER` controls retrieval embeddings.
- `huggingface` avoids paid embedding APIs and is the default provider.
- `openai` can still be used later if you get an embedding-capable API model.

## Task Plan For A Follow-up AI

1. Add a small frontend page for ingest, search, and ask flows.
2. Add URL ingestion so the service can fetch article text from a link.
3. Add edit APIs for correcting extracted cards and annotations.
4. Add deletion support and incremental reindexing.
5. Add auth if the service will be exposed outside localhost.
