# 任务：实现 Twitter/X 最新内容抓取模块，并在可行时整理为可复用 Skill

## 任务目标
实现一个可复用的 Twitter/X 内容抓取能力，能够输入用户名并返回最新 N 条推文。

本任务的第一目标是交付“真实可运行、可验证”的抓取模块。  
如果实现结构合适，再整理为标准 skill 形式；不要为了包装成 skill 而牺牲可运行性。

---

## 任务自主决策要求
你需要先判断这个任务本身有哪些可行实现路径，并自行选择当前环境下最稳妥的一种。

注意：
- 下方列出的技术路径只是候选参考，不是唯一限制
- 你可以自行补充、合并、删减方案
- 不要求机械地按给定顺序逐一尝试
- 你应优先选择“最有可能在当前环境中真实跑通”的方案
- 如果你判断某条路径没有尝试价值，可以跳过，但要记录原因

---

## 参考候选路径
以下方案可作为参考候选，但不构成限制：

- Twitter/X API v2
- snscrape 或类似第三方抓取库
- 基于 requests/httpx + HTML 解析的网页抓取
- 基于 Playwright 或其他浏览器自动化的抓取
- Nitter 或其他替代前端 / 镜像站方案

你可以自行判断：
- 是否需要新增其他候选方案
- 是否需要合并某些候选方案
- 哪些方案在当前任务中优先级更高
- 哪些方案不值得尝试

---

## 执行要求

### 1. 先做任务分析，不要直接写最终代码
先判断并输出：
- 该任务可能的实现方式有哪些
- 当前环境下最推荐优先验证的方案是什么
- 为什么这样排序
- 每种方案最小可行验证应该怎么做

### 2. 方案验证要“按方案类型设计”，不要机械套统一动作
不要为了满足形式而统一做 ping/import/demo。
应根据方案类型自行决定最小验证动作，例如：
- API 方案重点验证认证、接口可达性、返回字段
- 第三方库重点验证真实抓取是否成功
- 网页抓取重点验证页面可访问性、解析稳定性
- 浏览器自动化重点验证页面渲染、元素选择器、反爬风险

### 3. 找到可满足验收的稳定方案后，停止继续横向扩展
不要在已有可用方案后继续把所有备选都试一遍。  
只有在当前方案无法满足验收，或稳定性明显不足时，才切换下一方案。

### 4. 每完成一个阶段都要更新进度
每个阶段结束后：
- 在终端打印：`[✓] 阶段名`
- 更新 `.task_progress.json`

`.task_progress.json` 至少记录：
- 当前阶段
- 当前任务目标
- 已尝试方案
- 当前采用方案
- 遇到的问题
- 已完成步骤
- 验收命令
- 验收是否通过
- 下一步动作

### 5. 遇到外部依赖问题时优先自行解决
- 遇到库缺失，可直接安装
- 遇到方案跑不通，先分析原因，再决定是否切换方案
- 遇到网络问题，只能读取已有环境变量中的代理配置（如 HTTP_PROXY / HTTPS_PROXY），不要自行猜测代理地址
- 遇到认证缺失，应明确记录为环境限制

### 6. 禁止伪造成功
- 不要使用 mock 数据冒充真实结果
- 不要在没有运行测试时声称完成
- 不要把空结果当作成功
- 不要因为实现了函数接口就默认任务完成

---

## 最终交付物
优先交付以下文件：

```text
skill/
  __init__.py
  twitter_fetcher.py
  test_skill.py
  README.md
```

---

## 附加任务：适配 info-grab-manager

### 目标
统一 pull-Twitter 接口，使其与 pull-tiktok / pull-xhs 保持一致，支持：
1. 推文抓取（纯文本/图片）
2. 视频抓取（包含转写）
3. 统一的 `fetchTwitter()` 主函数
4. 完整的 job 集成机制

### 整体设计

#### 内容类型区分
在 `daily_jobs.json` 中通过 `content_type` 区分：
```javascript
// 纯推文（无视频）
content_type: { has_video: false, has_images: true/false, has_text: true }

// 视频推文
content_type: { has_video: true, has_images: true/false, has_text: true }
```

#### 主函数设计
`async function fetchTwitter(inputTextOrUrl, options = {})`

**流程：**
1. 解析输入（tweet URL / tweet ID）
2. 先获取推文元数据（通过 Nitter RSS 或 Chrome）
3. 判断是否有视频
4. 如果有视频 → 走视频下载流程 + 转写
5. 如果无视频 → 走纯推文抓取流程
6. 统一保存文件，更新 job 状态

#### 文件结构
```
downloads/2026-04-11/twitter/{tweet_id}-{sanitized_title}/
├── metadata.json      # 推文元数据
├── content.txt        # 推文文本
├── video.mp4          # （如果有视频）
├── transcript.txt     # （如果有视频）
├── transcript.json    # （如果有视频）
├── transcript.srt     # （如果有视频）
└── images/            # （如果有图片）
    ├── img0.jpg
    └── ...
```

### 任务清单

#### Phase 1: 设计和准备
- [x] 分析 tiktok/xhs 的统一接口模式
- [x] 设计 Twitter 的统一接口方案
- [ ] 创建 `fetch_twitter.js` 主脚本框架

#### Phase 2: 实现统一函数
- [ ] 实现 `fetchTwitter()` 主函数
- [ ] 集成 `fetchTwitterEnhanced()` 获取推文信息
- [ ] 集成 `downloadTwitterVideo()` 下载视频
- [ ] 实现内容类型检测（has_video / has_images / has_text）
- [ ] 实现目录创建和文件保存

#### Phase 3: Job 集成
- [ ] 支持 `options.job` 参数
- [ ] 实现 job 状态更新（raw → pending → processed）
- [ ] 实现 `addJobToDailyJobs()` 集成
- [ ] 实现 `addTimelineEvent()` 集成
- [ ] 实现 `addTaskToPlatformIndex()` 集成

#### Phase 4: 视频转写集成
- [ ] 集成 `video_transcriber`
- [ ] 实现视频转 wav
- [ ] 实现远端上传
- [ ] 实现转写结果回收
- [ ] 实现转写文件重命名（统一命名）

#### Phase 5: 测试
- [ ] 测试纯推文抓取（无视频）
- [ ] 测试视频推文抓取（有视频）
- [ ] 测试通过 info-grab-manager add
- [ ] 测试通过 info-grab-manager process
- [ ] 验证文件落盘
- [ ] 验证状态更新
- [ ] 验证转写流程（视频任务）

### 验收标准

1. [ ] 两个接口都通（推文 + 视频）
2. [ ] 能通过 info-grab-manager `add` 添加任务
3. [ ] 能通过 info-grab-manager `process` / `process-all` 处理
4. [ ] 针对视频任务：自动转 wav → 发远端 → 回收转写
5. [ ] daily_jobs.json 正确记录 content_type
6. [ ] 文件正确保存到对应目录