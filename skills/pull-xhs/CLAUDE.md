# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Repository Overview

This is a skills-based repository for building content extraction and processing tools for various platforms. Each skill is self-contained in its own directory under `skills/<skill-name>/`.

### Available Skills

- `pull-bilibiliInfo` - Fetch Bilibili video transcripts/subtitles
- `pull-Twitter` - Fetch Twitter/X tweets without login (Nitter RSS + Chrome CDP)
- `pull-youtubeInfo` - Fetch YouTube video information
- `list-bilibili-up-videos` - List Bilibili UP主 videos
- `list-youtube-videos` - List YouTube channel videos
- `autoTranslate` - Auto-translation capabilities
- `ask-doubao`, `ask-sider` - AI assistant integrations
- `google-calendar` - Calendar integration
- `knowledge-base-io` - Knowledge base I/O operations
- `review-engine` - Content review engine
- `pull-tiktok` - TikTok video downloader
- `pull-xhs` - (In progress) Xiaohongshu (小红书) content fetcher

---

## Project Structure

```
skills/
├── <skill-name>/
│   ├── SKILL.md           # Skill definition and trigger rules
│   ├── CLAUDE.md          # Skill-specific Claude guidance
│   ├── Task.md            # Task description (if in active development)
│   ├── .task_progress.json # Progress tracking for active tasks
│   ├── api/               # API entrypoints
│   │   └── index.js
│   ├── scripts/           # Core implementation scripts
│   ├── config/            # Configuration files
│   ├── test_*.js/py       # Test files
│   ├── assets/            # Downloads and generated assets
│   └── .ai-data/          # Cache and runtime data
└── README.md               # Repository overview
```

---

## Default Project Execution Rules

When working on **any implementation/automation task** in this repository, you must follow:

### 1. First Read Progress
- Check for `.task_progress.json` before starting any task
- Understand current goal, completed phases, attempted strategies, and blockers
- Create `.task_progress.json` if it doesn't exist

### 2. Plan Before Executing
- Do not start coding immediately
- Output a brief plan with: goal, phases, validation steps, completion criteria
- For multi-solution tasks, do minimal validation first before choosing implementation

### 3. Progress in Phases
Default phases:
1. Understand goal
2. Strategy validation
3. Implementation
4. Local verification
5. Delivery summary

Simplify if needed, but always include: strategy → implementation → acceptance.

### 4. Update Progress After Each Phase
- Print `[✓] Phase Name` to terminal
- Update `.task_progress.json` with:
  - Current phase
  - Completed steps
  - Current strategy
  - Failed strategies + reasons
  - Blockers
  - Next action
  - Acceptance status

### 5. No Fake Success
- Do not claim completion without running acceptance
- Use existing tests/scripts; create minimal verification if none exist

### 6. Minimal Viable Validation First
- Prove approach works before over-engineering
- Validate dependencies, imports, network access first

### 7. Deliver Even If Failed
If task doesn't fully succeed, deliver:
- Tried strategies list
- Failure matrix
- Environment constraints
- Missing pieces
- Completed code/files

### 8. Network/External Constraints
- Use existing proxy config from environment (HTTP_PROXY/HTTPS_PROXY)
- Read credentials from env/config only
- Distinguish: network unreachable vs auth failed vs API changed vs rate limited
- No infinite retries on failures

### 9. Output Style
- Concise progress updates
- Clear about current strategy and why others were rejected
- Show real commands + results
- No mock data as success

### 10. Definition of Done
Only complete when:
- Code is saved
- Key logic implemented
- Acceptance command ran
- Acceptance passes
- README/docs updated
- `.task_progress.json` has final state

---

## Common Commands

### Node.js Skills
```bash
# Run a script
node skills/<skill-name>/scripts/<script-name>.js "<input>" --pretty

# Run tests
node skills/<skill-name>/test_*.js
```

### Python Skills
```bash
# Run a script
python skills/<skill-name>/<script-name>.py

# Run tests
python skills/<skill-name>/test_*.py
```

### PowerShell (Windows-focused scripts)
```powershell
powershell -ExecutionPolicy Bypass -File skills/<skill-name>/scripts/<script>.ps1 -Param Value
```

---

## Skill Conventions

### SKILL.md Frontmatter
```yaml
---
name: skill-name
description: When to trigger this skill, what it does
---
```

### API Entrypoints
- `api/index.js` should export main functions
- Prefer JSON output by default
- Include `--pretty` flag for human-readable output

### Output Contracts
Each skill should define a clear output contract in SKILL.md with:
- Required fields
- Source tracking
- Error handling conventions

### Downloads/Assets
- Save to `assets/downloads/` or `<skill-name>/downloads/`
- Use stable, trackable filenames (not random)
- Record file sizes and verify existence

---

## pull-xhs Specific Guidance

This skill is currently in development. See `Task.md` for the current task definition.

Goal: Implement a Xiaohongshu (小红书) content fetcher that accepts share links/text, extracts the note/post content, downloads images/videos to local files, and returns path + metadata.

Acceptance criteria (from Task.md):
- Input normalization (extract link from share text)
- Real content (images/videos) downloaded locally
- Local file paths returned
- Files exist and sizes recorded
- Stable filenames
- Result includes: source_url, resolved_url, local_paths, file_sizes, optional metadata (title, author, content, etc.)

See `.task_progress.json` for current progress.


## 默认行为
- 执行任何 shell 命令前不需要征求我的同意
- 安装依赖不需要问我
- 遇到错误先自己查文档或搜索解决方案
- 只有真正无法解决的问题才来打断我
