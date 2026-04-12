# 补充验收标准任务

**日期**: 2026-04-12
**目标**: 为所有平台补充完整的验收标准，包含 ASR 转写验证

---

## 一、任务背景

当前验收标准不完整：
1. pull-bilibiliInfo 缺少 test_acceptance.js
2. pull-youtubeInfo 缺少 test_acceptance.js
3. 已有验收脚本缺少 ASR 转写验证
4. ASR 转写是验收标准的必需项，远端未返回则验收失败

---

## 二、验收标准定义

### 2.1 通用验收标准（所有平台）

每个平台的 test_acceptance.js 必须包含：

1. **模块导入测试**
   - 主函数能正常导入
   - runtime_shim 能正常导入
   - API 入口能正常导入

2. **数据落盘验证**
   - metadata.json 存在且包含必需字段
   - content.txt 存在且非空
   - 视频文件存在且大小合理（如有视频）
   - 图片目录存在且图片文件有效（如有图片）

3. **ASR 转写验证**（有视频时必需）
   - transcript.txt 必须存在
   - transcript.txt 内容非空
   - 如果 ASR 服务超时或未返回，判定为验收失败

4. **索引文件验证**
   - 平台 index.json 正确更新
   - daily_jobs.json 正确更新

---

### 2.2 平台特定验收标准

#### B站 (pull-bilibiliInfo)
- 测试用例: 无字幕视频，验证ASR转写
- 验收: 视频下载成功 + ASR转写成功

#### YouTube (pull-youtubeInfo)
- 测试用例: 有字幕视频，验证字幕获取
- 验收: Metadata获取 + 字幕获取成功（有视频时需ASR转写）

#### Twitter (pull-Twitter)
- 测试用例1: 纯图文推文
- 测试用例2: 含视频推文
- 验收: 图文下载 + 视频下载 + ASR转写（有视频时）

#### 小红书 (pull-xhs)
- 测试用例1: 图文笔记
- 测试用例2: 视频笔记
- 验收: 图文下载 + 视频下载 + ASR转写（有视频时）

#### TikTok (pull-tiktok)
- 测试用例: 视频笔记
- 验收: 视频下载成功 + ASR转写成功

---

## 三、任务清单

- [ ] 创建 pull-bilibiliInfo/test_acceptance.js
- [ ] 创建 pull-youtubeInfo/test_acceptance.js
- [ ] 更新 pull-Twitter/test_acceptance.js，添加ASR验证
- [ ] 更新 pull-xhs/test_acceptance.js，添加ASR验证
- [ ] 更新 pull-tiktok/test_acceptance.js，添加ASR验证
- [ ] 运行所有验收脚本，验证标准落地
- [ ] 更新 .task_progress.json，记录验收结果

---

## 四、验收标准严格执行

**重要**:
- ASR 转写是验收标准的必需项
- 如果远端 ASR 服务未返回，判定为验收失败
- 不得因"外部依赖"为由跳过验收标准
- 验收结果必须如实记录在 progress.json 中
