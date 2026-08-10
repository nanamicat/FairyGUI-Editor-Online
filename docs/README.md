# 项目文档

- [系统架构](./architecture.md)：运行时、统一编辑模型、浏览器存储、发布与目录边界。
- [Editor Workbench 模块架构](./editor-workbench-architecture.md)：当前模块清单、服务依赖、生命周期、数据流与下游复用方式。
- [编辑工作流](./editor-workflows.md)：工程生命周期、画布交互、属性检查器、历史记录和预览行为。
- [OpenFairyGUI 集成](./openfairygui-integration.md)：包职责、会话、事务、保存与升级约束。
- [浏览器插件](./browser-plugins.md)：安装来源、权限、沙箱与第一版写入边界。

回归脚本位于 `scripts/internal/`，运行 `npm run verify` 后会在本地生成 `verification/reports/`。
