# Review Engine Content Format

This document defines the JSON format for adding or expanding local review content.

Use this when:

- manually writing cards
- asking an LLM to generate new cards
- asking an LLM to extend an existing deck with follow-ups
- preparing candidate cards for later approval

## Primary deck file shape

The engine accepts either:

1. an object with a `notes` array
2. a raw array of note objects

Recommended shape:

```json
{
  "notes": [
    {
      "deckName": "Graphics Engine Interview",
      "domain": "graphics",
      "questionType": "mechanism",
      "difficulty": "mid",
      "fields": {
        "Front": "什么是帧图（Frame Graph）？为什么现代渲染器常用它管理渲染流程？",
        "Back": "帧图用有向图描述渲染 pass 与资源读写依赖。它能自动推导资源生命周期、pass 顺序、barrier、aliasing 和临时资源复用，降低渲染流程维护成本，并提升显存利用率与正确性。"
      },
      "tags": ["graphics-engine", "frame-graph", "interview"],
      "followups": [
        {
          "question": "为什么 frame graph 能自动推导资源 barrier？",
          "concept": "barrier 推导",
          "coveredSignals": ["barrier", "状态转换", "资源状态", "读写依赖"],
          "tags": ["followup", "barrier"]
        },
        {
          "question": "为什么资源 aliasing 能成立？",
          "concept": "资源生命周期与 aliasing",
          "coveredSignals": ["aliasing", "生命周期", "临时资源复用", "复用同一块内存"],
          "tags": ["followup", "aliasing"]
        }
      ]
    }
  ]
}
```

## Required fields

Each note should include:

- `deckName`
- `fields.Front`
- `fields.Back`

## Optional fields

- `domain`
- `questionType`
- `difficulty`
- `tags`
- `followups`

Recommended `domain` values:

- `graphics`
- `rendering`
- `engine`
- `unity`
- `unity-performance`
- `cpp`
- `csharp`

Recommended `questionType` values:

- `definition`
- `mechanism`
- `tradeoff`
- `debugging`
- `performance`
- `design`
- `coding`

## Follow-up design guidance

Follow-ups should not be trivial restatements of the main answer.

Good follow-ups:

- ask for missing mechanism
- ask for tradeoff
- ask for failure mode
- ask for why, not only what
- ask for practical engine or runtime consequences when the domain is Unity / C++ / C#

Bad follow-ups:

- repeat something already stated in the user's first answer
- ask a narrower synonym of the main question
- focus on wording instead of understanding

Use `coveredSignals` to suppress repeated follow-ups when the first answer already covered the concept.

## Candidate card file shape

Use this when AI proposes new cards based on weak points exposed during an interview round:

```json
[
  {
    "deckName": "Graphics Engine Interview",
    "front": "为什么 frame graph 能自动推导资源 barrier？",
    "back": "因为 frame graph 显式知道每个 pass 对资源的读写关系和执行顺序，所以可以在资源访问模式变化时自动插入所需的状态转换与同步。",
    "tags": ["graphics-engine", "frame-graph", "followup"],
    "sourceCardId": "87456c48-fda1-42e7-bb26-dce328d6efba",
    "sourceType": "ai-generated",
    "reason": "主问题回答后暴露出对 barrier 推导机制需要单独强化。"
  }
]
```

## Prompting an LLM to extend the deck

When asking an LLM to generate more content, tell it:

- preserve the existing JSON structure exactly
- keep `Front` concise and interview-style
- keep `Back` as a compact reference answer
- set `domain`, `questionType`, and `difficulty` when clear
- add `followups` only when they probe a distinct missing concept
- avoid redundant follow-ups
- include `coveredSignals` so repeated concepts can be skipped

Recommended deck split:

- `Graphics Engine Interview`
- `Unity Performance Interview`
- `C++ Interview`
- `C# Interview`

Example prompts for an LLM:

- "Extend `Graphics Engine Interview` with 20 medium/hard rendering and engine architecture questions."
- "Add 15 `Unity Performance Interview` questions focused on profiler usage, GC, batching, SRP Batcher, memory, and rendering."
- "Add 20 `C++ Interview` questions focused on ownership, move semantics, virtual dispatch, cache behavior, and concurrency."
- "Add 15 `C# Interview` questions focused on GC, async/await, value vs reference semantics, collections, and Unity runtime behavior."

## Import commands

Batch import notes:

```bash
bash skills/review-engine/scripts/review_engine.sh add-json --file ./your_cards.json
```

Inspect cards:

```bash
bash skills/review-engine/scripts/review_engine.sh search --query "frame graph" --limit 10
```
