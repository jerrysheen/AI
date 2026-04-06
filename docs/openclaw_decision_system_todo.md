# OpenClaw Information Capture and Decision System TODO

## Goal

Build a long-running information capture and decision support system around OpenClaw on a Mac mini.

Primary objectives:

- run 24/7
- continuously collect industry information from selected sources
- filter, deduplicate, tag, and store useful signals
- use low-cost models for bulk analysis
- escalate important items to stronger models for deeper judgment
- deliver concise outputs to Telegram
- keep a durable decision trail so later conclusions can be audited

## Non-Goals

- do not start with fully autonomous trading or automatic execution
- do not start with unlimited multi-agent debate on every item
- do not let agents browse or message with broad default permissions
- do not depend on memory or chat history as the primary source of truth

## Phase 0: Machine and Runtime Baseline

- buy and prepare `Mac mini M4 Pro`
- prefer `64GB RAM`
- prefer `1TB SSD`
- connect UPS
- prepare a dedicated always-on user account
- enable remote access and basic monitoring
- define repo-local runtime layout under `.ai-data/`

Deliverables:

- machine provisioning checklist
- `.env.example` updated for OpenClaw-related variables
- startup and restart strategy documented

## Phase 1: OpenClaw Base Deployment

- install OpenClaw on macOS
- configure Gateway as the long-running core process
- connect Telegram channel/bot as the main output surface
- verify background operation after reboot
- separate workspace, logs, caches, and secrets

Open questions:

- run OpenClaw directly on host or inside a controlled wrapper
- whether to keep a second Linux node later for redundancy

Deliverables:

- `docs/openclaw_setup.md`
- bootstrap scripts under `scripts/`
- health check command set

## Phase 2: Source Ingestion Layer

Start with a narrow source set.

Candidate sources:

- official company blogs
- product release notes
- regulatory/news sites
- GitHub releases and commits
- selected X/Twitter accounts if an API path is practical
- RSS feeds wherever possible

Rules:

- prefer structured sources first
- avoid browser automation unless a source forces it
- store raw source payloads before LLM analysis
- every item must carry source URL, timestamp, and source type

Deliverables:

- source registry file under `.ai-data/config/watchlists/`
- ingestion manifests under `.ai-data/<source>/runs/`
- canonical cache format under `.ai-data/cache/`

## Phase 3: Normalization and Filtering

Before any expensive model call:

- deduplicate near-identical items
- cluster repeated reports of the same event
- extract title, summary, entities, date, source, and topic
- assign confidence and source credibility
- drop low-signal items

This phase should be mostly deterministic code, not LLM-first.

Deliverables:

- shared normalized schema
- basic scoring rules
- source credibility map

## Phase 4: Model Routing Strategy

Use model tiers instead of one model for everything.

Default tier:

- `DeepSeek` or a domestic low-cost model
- use for summarization, tagging, classification, and quick triage

Upgrade tier:

- `Claude Sonnet` or `GPT`
- use only when an item is important, ambiguous, or decision-relevant

Execution tier:

- `Codex CLI` or `Gemini CLI`
- use only for bounded heavy tasks such as code inspection, structured report generation, or deeper tool-driven workflows

Routing rules to define:

- what makes an item high-priority
- when to escalate from cheap model to strong model
- when to call an external CLI agent instead of a normal API model
- hard monthly spend caps

Deliverables:

- model routing matrix
- escalation thresholds
- cost guardrails

## Phase 5: Multi-Agent Design

Do not start with many agents. Start with a minimal, legible set.

Recommended initial roles:

- `scout`: finds and fetches items
- `summarizer`: creates compact summaries and tags
- `skeptic`: checks for missing assumptions, weak evidence, and alternative explanations
- `decision`: writes the final judgment and suggested action

Rules:

- not every item gets all agents
- cheap path first
- `skeptic` and `decision` only run on promoted items
- each agent has a narrow prompt and tool scope

Important:

- OpenClaw provides routing, sessions, scheduling, channels, and tool integration
- better "agent debate" behavior comes from our workflow design, not from OpenClaw by itself

Deliverables:

- per-agent prompt specs
- per-agent tool permissions
- session handoff design

## Phase 6: Decision Output Format

Define a stable output format for Telegram.

Suggested structure:

- what happened
- why it matters
- confidence
- key evidence
- opposing view
- suggested action
- follow-up needed

Levels:

- `info`
- `watch`
- `important`
- `decision-required`

Deliverables:

- Telegram message templates
- severity taxonomy
- alert throttling rules

## Phase 7: Memory and Evidence

Do not let freeform memory drive decisions.

Use two layers:

- evidence store: raw items, normalized records, and prior reports
- decision log: what conclusion was made, why, by which model path, with which confidence

Requirements:

- every final decision should reference evidence ids or source URLs
- store rerun-friendly artifacts
- support later review of wrong decisions

Deliverables:

- decision log schema
- evidence index schema
- retention policy

## Phase 8: Cost Control

Need explicit controls before scaling.

- token budget by day and month
- item count limits per source
- summary length caps
- hard cap on strong-model escalation
- optional digest mode during low-value periods

Metrics to track:

- items ingested per day
- items promoted to stronger models
- total tokens by model
- cost per day
- number of Telegram alerts
- alert precision after manual review

Deliverables:

- cost dashboard spec
- budget enforcement hooks

## Phase 9: Reliability and Operations

- process supervision
- restart on failure
- stale queue detection
- log rotation
- disk usage control
- source fetch timeout and retry rules
- Telegram send failure retry rules

Deliverables:

- operational runbook
- recovery checklist
- on-host monitoring script

## Phase 10: Security

- keep API keys in environment or secret manager only
- minimize OpenClaw tool permissions by agent role
- isolate browser profiles
- review third-party skills before enabling
- restrict outbound actions by default
- define a safe allowlist for channels and tools

Deliverables:

- security checklist
- secret inventory
- agent permission matrix

## Suggested Build Order

1. Mac mini procurement and baseline OS setup
2. OpenClaw install and Telegram output test
3. one-source ingestion proof of concept
4. deterministic normalization and dedup
5. cheap-model summarizer path
6. strong-model escalation path
7. minimal multi-agent flow
8. decision log and replayability
9. cost controls
10. wider source rollout

## First Milestone

Define a minimal version that is worth using daily:

- 5 to 10 trusted sources
- one Telegram digest three times per day
- one urgent alert path
- one cheap default model
- one strong escalation model
- one decision log file

Success criteria:

- can run for 7 days without manual babysitting
- useful signal-to-noise ratio
- monthly model cost is acceptable
- each alert can be traced back to original evidence

## Later Extensions

- add browser-only sources
- add company/topic watchlists
- add portfolio or strategic-theme mapping
- add human feedback loop for alert quality
- add long-horizon thesis tracking
- add Linux fallback node if local-only availability becomes a risk

