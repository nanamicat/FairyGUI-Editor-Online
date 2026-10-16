# 工程协作约定

## 分支和提交

- 当前工作分支为 `file-system`，将本任务的提交推送到 `fork/file-system`。
- `origin` 保留为上游 `https://github.com/OpenFairyGUI/FairyGUI-Editor-Online.git`；`fork` 指向用户授权的 `https://github.com/nanamicat/FairyGUI-Editor-Online.git`。使用明确的分支 refspec 推送，并让本地 `file-system` 跟踪 `fork/file-system`。
- 用户明确要求不改动 `main`：不要向 `main` 提交、合并或推送，也不要强制推送。
- 本仓库提交身份为 `nanamicat <nanamicat77@gmail.com>`，通过仓库级 Git 配置设置。
- 推送前检查当前分支、暂存内容和验证结果；保留与本任务无关的用户修改。

## 本地凭据

- GitHub 凭据仅保存在本机 `.git/` 下的本地设置文件中，由仓库级 credential helper 读取。
- 不把 token 写入源码、文档、Git remote URL、提交信息或日志，不将凭据文件加入版本控制。
- 身份验证失败时报告实际错误，不自动改推其他仓库或主分支。

## 实现边界

- 使用 TypeScript 严格模式、LayaAir 和 FairyGUI 组件，沿用现有 Workbench 与模块生命周期。
- 官方 UI 来源是 `vendor/FairyGUI-Editor/ui` 子模块；优先复用其组件，通过 TypeScript 适配在线行为，不修改子模块。
- 工程事实来源是 OpenFairyGUI UAM；修改、保存和历史操作继续通过 Session 队列与现有事务层。
- 启动默认显示 `Builder/StartScene`，不自动打开示例或连接编辑会话。
- 目录选择和权限请求必须在用户点击路径上立即触发，不等待会话队列或 IndexedDB。
- 首页使用一次 `showDirectoryPicker({ mode: "readwrite" })` 同时请求目录读写权限，不增加应用自己的第二次授权步骤。不要把选择器的 `AbortError` 静默吞掉。用户明确拒绝以导入副本替代本地目录授权，不添加这种降级路径。
- 浏览器联调使用用户设置的系统默认浏览器。用户手动处理系统目录选择与授权对话框，代理观察调用返回与加载状态。
- 大工程读取应显示文件数量和字节进度，忽略 `.objs`、`.git`、`.svn` 和 `node_modules` 缓存目录。
- 保留目录句柄持久化、授权失败处理、保存冲突检测与写回恢复机制；新建本地工程只使用空目录。
- 首页打开本地项目使用独立浏览器工作区；工具栏导入保留确认后替换工作区的行为。
- 工程打开和磁盘保存仅支持 File System Access API，不提供工程 ZIP 导入、ZIP 导出或文件夹只读降级；不支持目录句柄的浏览器应明确提示。
- 本地新建工程目前使用 LayaAir 格式。共享 ZIP 解析仅用于 FairyGUI 资源包，已发布运行时包和资源导出不属于整个工程的 ZIP 传输。

## 验证和维护

- 基础检查：`npm run typecheck`、`npm run build`、`git diff --check`。
- 文件系统相关回归：
  - `node scripts/internal/verify-browser-file-system-access.mjs`
  - `node scripts/internal/verify-browser-archive.mjs`
  - `node scripts/internal/verify-phase8-directory-writeback-policy.mjs`
  - `node scripts/internal/verify-browser-session-lifecycle-race.mjs`
  - `node scripts/internal/verify-editor-workbench.mjs`
  - `node scripts/internal/verify-phase10-ui-interactions.mjs`
- 改动浏览器保存后，按需运行 `verify-phase8-browser-storage-save.mjs` 和 `verify-phase8-clean-materialize.mjs`。
- UI 改动检查首页、新建、打开、最近项目、拒绝/取消授权，并确认工程 ZIP 入口和只读降级不存在。明确区分模拟目录选择器的自动化测试与实际系统授权弹窗验证。
- 测试报告、截图和临时浏览器脚本放在已忽略的 `verification/reports/` 中。
- 持续维护本文件：实现边界、验证入口或用户约定发生变化时同步更新；不要把聊天记录和临时状态堆入本文件。
