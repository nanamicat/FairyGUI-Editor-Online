# OpenFairyGUI 集成

## 包职责

- `@openfairygui/core`：工程读写、统一编辑模型、事务类型和资源格式。
- `@openfairygui/functions`：工程提升、恢复与发布相关函数。
- `@openfairygui/backend`：浏览器安全会话、事务、存储适配器与 `publishBrowser()`。
- `@openfairygui/cli`：维护脚本中的 Node.js 发布入口。

版本在 `package.json` 中精确锁定。浏览器运行时使用 `assets/resources/editor/runtime/openfairygui-backend-browser.js`，它必须由同一组依赖生成。`npm run generate` 负责重建工程快照、静态运行时预览和浏览器运行时；`npm run verify` 会执行同一生成链并继续运行完整回归。

## 会话规则

已有浏览器工作区必须通过 `BackendRuntime({ fileSystem }).openSession({ projectPath })` 打开，由后端读取源工程并报告保真度。无法读取、工程提升失败或保真度为 `unsupported` 时，保存和物化操作必须保持零写入，不能静默回退为默认工程。

`openProjectSession()` 只用于明确的空工作区初始化或内部内存验证。活跃工作区使用 Web Locks 阻止第二个标签同时写入；页面刷新或终止后锁必须可释放并重新打开。

## 事务规则

产品代码只调用公开的 UAM 事务。每个编辑动作必须具备：

- 精确选择器和类型化操作。
- 提交前依赖与引用校验。
- 可逆的原子操作组。
- 应用后的当前快照同步。
- 保存并重载后的目标后验。

显示节点、资源、组件、控制器、动效、关联和齿轮属性都遵循同一历史路径。跨包操作必须显式规划组件、图片、动画、字体、声音及 `ui://` 引用依赖；未知依赖结构会在提交前拒绝。

## 二进制资源与发布

资源字节在 UAM 中以 `Uint8Array` 处理，历史快照使用 `structuredClone` 保持二进制安全。保存或执行反向 `addResource` 时不得携带只读 `sourcePath`。

发布使用当前会话已经保存的存储检查点，不从运行时对象或未保存的工作副本生成。发布完成后由 `AuthoringRuntimePackageLoader` 加载 `.fairygui-runtime/manifest.json`，校验工程和包后为 `.fui`、图集和音频创建 Blob URL。

## 升级流程

升级 OpenFairyGUI 时必须同步：

1. 更新四个 `@openfairygui/*` 的精确版本并安装依赖。
2. 运行 `npm run verify`，重建浏览器包、UAM 基线、快照和静态运行时包。
3. 运行 `npm run typecheck` 与 `npm run build`。
4. 在浏览器验证导入、编辑、撤销/重做、保存/重载、发布、刷新恢复和控制台。

内部脚本允许通过 `OPENFAIRYGUI_MODULE_ROOT` 临时指向 OpenFairyGUI 工作区的 `packages/`，但发布产物必须由 `package.json` 锁定版本重新生成。
