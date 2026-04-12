# CLAUDE.md - Harness Engineering 规范

本文件定义 Claude Code 在本项目中的执行规范，**核心是将验收从主观判断变为客观脚本执行**。

---

## 0. 最高原则：验收驱动开发

任何任务在宣称"完成"前，必须满足：

1. **test_acceptance 全过** - 有验收脚本则必须 100% 通过
2. **检查清单逐项验证** - Task.md 中的每个检查项都有对应命令输出
3. **禁止模糊表述** - 不许用"基本完成"、"部分成功"、"应该可以"

---

## 1. 任务执行流程

```
理解目标 → 方案验证 → 实现 → 本地验证 → 【验收关卡】 → 交付
                                         ↓
                            不通过则返回修改，直到通过
```

### 验收关卡（硬性门槛）
验收不通过，任务不算完成。验收包含两个部分：

#### A. 自动化验收脚本
- 位置：`skills/<skill-name>/test_acceptance.js`（或 .py）
- 要求：
  - 必须以非 0 退出码表示失败
  - 必须输出清晰的"通过/失败"结果
  - 每个测试项都有明确的验收标准
- 运行：`node test_acceptance.js` 或 `python test_acceptance.py`

#### B. 手动检查清单
- 位置：`Task.md` 中的 `### 验收标准` 段落
- 格式：每个检查项必须带**验证命令**
  ```markdown
  - [ ] 能抓取推文 - 验证：`node test_acceptance.js::testFetchTweet`
  - [ ] 文件正确落盘 - 验证：`ls downloads/2026-04-11/twitter/...`
  ```
- 要求：每个检查项必须贴出命令执行结果

---

## 2. test_acceptance.js 规范

### 模板结构
```javascript
#!/usr/bin/env node
/**
 * 验收测试脚本 - 必须全部通过才算任务完成
 * 运行：node test_acceptance.js
 */

const colors = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
};

const tests = [
  {
    name: "能正常调用主函数",
    fn: async () => {
      const { fetchTwitter } = require('./scripts/fetch_twitter');
      const result = await fetchTwitter("https://x.com/user/status/123");
      if (!result || !result.success) throw new Error("调用失败");
      return true;
    }
  },
  {
    name: "文件正确落盘",
    fn: async () => {
      const fs = require('fs');
      const path = require('path');
      const testPath = path.join(__dirname, 'downloads/test/metadata.json');
      if (!fs.existsSync(testPath)) throw new Error(`文件不存在: ${testPath}`);
      const metadata = JSON.parse(fs.readFileSync(testPath, 'utf8'));
      if (!metadata.source_url) throw new Error("metadata 缺少 source_url");
      return true;
    }
  },
  // 更多测试...
];

async function main() {
  let passed = 0;
  let failed = 0;

  console.log("\n=== 验收测试开始 ===\n");

  for (const test of tests) {
    try {
      process.stdout.write(`  ${test.name} ... `);
      await test.fn();
      console.log(`${colors.pass} 通过`);
      passed++;
    } catch (error) {
      console.log(`${colors.fail} 失败`);
      console.log(`    错误: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n=== 结果: ${passed}/${tests.length} 通过 ===\n`);

  if (failed > 0) {
    console.log("❌ 验收未通过，请修复后重试");
    process.exit(1);
  } else {
    console.log("✅ 验收全部通过！");
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error("验收脚本执行出错:", err);
    process.exit(1);
  });
}

module.exports = { tests };
```

### 验收测试编写原则
1. **只测验收标准，不测实现细节**
2. **每个测试对应 Task.md 中的一个验收项**
3. **测试必须是端到端的**（从输入到文件落盘）
4. **失败时给出明确的错误信息**

---

## 3. Task.md 验收清单规范

### 模板
```markdown
## 验收标准（必须全部通过）

### 自动化验收
- [ ] 运行 `node test_acceptance.js` 全部通过 - 输出：[粘贴结果]

### 功能检查
- [ ] 能抓取纯文本推文 - 验证：`node scripts/fetch_twitter.js "https://x.com/..." --pretty`
  > 输出：[粘贴结果]
- [ ] 能下载视频推文 - 验证：`ls -lh downloads/.../video.mp4`
  > 输出：[粘贴结果]
- [ ] metadata.json 包含必需字段 - 验证：`cat downloads/.../metadata.json`
  > 输出：[粘贴结果]

### 集成检查
- [ ] 能通过 job_manager add 添加任务 - 验证：`node src/shared/job_manager.js add "https://x.com/..."`
  > 输出：[粘贴结果]
- [ ] 能通过 job_manager process 处理任务 - 验证：`node src/shared/job_manager.js process <job_id>`
  > 输出：[粘贴结果]
```

### 检查清单编写原则
1. **每个检查项都是可验证的**（有命令）
2. **验证命令必须是可复制的**（不要用相对路径）
3. **必须粘贴命令输出**（空口无凭）
4. **集成测试必须用真实的 job_manager 流程**

---

## 4. Claude 的验收判断准则（严格执行）

### 什么情况下可以说"任务完成"？
**同时满足**：
1. `test_acceptance.js` 运行结果显示 `✅ 验收全部通过！`
2. Task.md 中所有检查项都已勾选，且每个都有命令输出
3. `.task_progress.json` 中 `acceptance.overall_pass === true`

### 什么情况下绝对不能说"完成"？
- test_acceptance 有任何失败
- 任何一个检查项没有验证命令或输出
- 使用"基本"、"大概"、"应该"这类模糊词汇
- 用 mock 数据冒充真实结果
- 跳过验收直接宣称成功

### 验收失败时该怎么做？
1. 明确列出：哪项没过、错误信息、还差什么
2. 更新 `.task_progress.json`：
   ```json
   {
     "current_phase": "验收失败",
     "acceptance": {
       "overall_pass": false,
       "failed_items": ["文件正确落盘", "job 状态更新"],
       "errors": ["metadata.json 缺少 source_url", "job status 仍为 raw"]
     }
   }
   ```
3. 返回实现阶段修复，而不是找借口

---

## 5. .task_progress.json 验收字段规范

```json
{
  "current_phase": "验收",
  "acceptance": {
    "test_acceptance_passed": false,
    "test_acceptance_output": "=== 结果: 2/3 通过 ===",
    "checklist": [
      {
        "item": "能抓取推文",
        "verified": true,
        "command": "node test_acceptance.js::testFetchTweet",
        "evidence": "✓ 通过"
      },
      {
        "item": "能下载视频",
        "verified": false,
        "command": "ls downloads/.../video.mp4",
        "evidence": "文件不存在"
      }
    ],
    "overall_pass": false,
    "summary": "视频下载失败，需要修复"
  }
}
```

---

## 6. 项目默认执行规则（继承自 skills/pull-tiktok/CLAUDE.md）

1. **先读进度，再开始** - 检查 `.task_progress.json`
2. **先规划，再执行** - 输出计划：目标、阶段、验证、完成条件
3. **严格按阶段推进** - 理解→验证→实现→验收→交付
4. **每个阶段结束都要更新进度** - 打印 `[✓] 阶段名`，更新 `.task_progress.json`
5. **不允许跳过验证直接宣称完成** - 必须运行验收命令
6. **优先做最小可行验证** - 先证明方案可跑通
7. **失败时也要可交付** - 尝试列表、失败矩阵、环境限制
8. **网络/外部服务约束** - 用已有代理，不伪造凭证
9. **输出风格要求** - 简洁、明确、贴真实结果
10. **对实现类任务的默认完成定义** - 代码落盘+逻辑实现+验收通过+文档更新

---

## 7. 目录结构约定

```
skills/<skill-name>/
├── SKILL.md              # Skill 定义
├── CLAUDE.md             # Skill 特定规范
├── Task.md               # 当前任务描述 + 验收清单
├── .task_progress.json   # 进度跟踪
├── test_acceptance.js    # 【必需】验收测试脚本
├── api/
│   └── index.js
├── scripts/
│   └── main_script.js
├── test_*.js             # 其他测试（可选）
├── downloads/            # 测试下载目录
└── assets/
```

---

## 8. 常见命令

### 验收相关
```bash
# 运行验收测试（必须在宣称完成前执行）
cd skills/<skill-name>
node test_acceptance.js

# 运行单个验收测试项
node test_acceptance.js --test "能抓取推文"
```

### 任务管理
```bash
# 添加任务
node src/shared/job_manager.js add "<url>"

# 处理任务
node src/shared/job_manager.js process <job_id>

# 列出任务
node src/shared/job_manager.js list
```

---

## 9. 默认行为

- 执行任何 shell 命令前不需要征求同意
- 安装依赖不需要问
- 遇到错误先自己查文档或搜索解决方案
- 只有真正无法解决的问题才来打断
- **验收必须严格执行，不得放水**
