# 架构

## 系统边界

FairyGUI Editor Online 由编辑器外壳、统一编辑模型、浏览器工作区和运行时预览四部分组成：

1. `vendor/FairyGUI-Editor/ui` 通过官方 submodule 提供编辑器自身的 `Basic` / `Builder` UI 发布输入；在线专属差异由 TypeScript 运行时补齐。
2. 被编辑工程由 OpenFairyGUI 读取为统一编辑模型（UAM），UAM 是工程事实来源。
3. 工程文件保存在 OPFS 或 IndexedDB，并可选择性写回本地文件夹。
4. 已发布的 `.fui`、图集和音频只用于高保真预览，不反向生成编辑数据。

编辑器外壳与被编辑工程必须保持分离。默认被编辑工程由官方 submodule 提供，路径是 `samples/FairyGUI-layabox/demo/UIProject/FairyGUI-layabox-demo.fairy`。

## 启动与构建

Vite 以 `src/vite-entry.ts` 为 Web 入口。入口初始化冻结的 LayaAir 3.3.10 舞台，再调用 `src/Main.ts` 创建 FairyGUI `GRoot` 和 `Builder/MainView`。`assets/` 是 Vite 的 `publicDir`，其中的 LayaAir、FairyGUI 运行时、编辑器界面包和 OpenFairyGUI 浏览器包会原样进入构建产物。

`npm run publish:editor-ui` 使用 OpenFairyGUI CLI 的 `--project-type layabox` 从 `vendor/FairyGUI-Editor/ui` 发布 `assets/resources/ui`。submodule 保持上游原样；运行时在 `MainView` 创建前注册统一 Loader 扩展，并在 `EditorShell` 初始化时设置浏览器版启动入口、可见性和提示文字。

`vite-dist/` 是唯一 Web 构建输出目录，不应手工修改。仓库只保留运行时所需的 LayaAir 声明和冻结脚本，不再维护 LayaAir IDE 工程或 `bin/` 发布镜像。

## 编辑器结构

`EditorShell` 把顶部菜单和工具栏、左侧资源库/层级树/预览区、中间文档视图、右侧属性检查器与底部时间轴挂载到 `Builder/MainView`。具体职责分布在：

- `src/editor/commands/`：事务准备、预检和历史组。
- `src/editor/services/`：OpenFairyGUI 会话、浏览器存储、导入、保存与运行时包生命周期。
- `src/editor/ui/`：属性检查器、时间轴、画布和面板交互。
- `src/editor/model/`：工作区、快照、选区与命令状态。

界面状态和工程状态分开保存。标签页、`GroupPath`、布局、快捷键和 `TestView` 设备状态不进入 UAM，也不改变未保存状态检查点。

## 数据流

打开已有工作区时，`BrowserLiveSessionBridge` 通过存储支持的 OpenFairyGUI 会话读取 `.fairy` 工程并计算保真度，再把当前 UAM 转为 `ProjectSnapshot`。空工作区只能通过显式初始化写入默认 UAM。

所有工程修改按以下路径执行：

1. 界面从当前 UAM 准备类型化事务。
2. 共享预检逻辑校验选择器、依赖和批次原子性。
3. 后端应用成功后同步快照、选区、属性检查器和画布投影。
4. `EditorCommandAdapter` 保存正向/反向操作组，提供撤销和重做。
5. 保存操作写入浏览器工作区，并重新读取目标进行后验校验。

运行时对象不参与事务生成。尚未重新发布的资源或行为变化会标记为 `publish-required`。

## 存储与导入

`BrowserProjectStorage` 优先使用 OPFS，不可用时使用 IndexedDB。工程只通过 File System Access API 选择目录，不提供工程 ZIP 导入、导出或只读目录降级。首页打开本地目录时为项目建立独立工作区；工具栏目录导入先构造文件树并显示预览，用户确认后才替换当前浏览器工作区。首页默认保持欢迎页，预加载最近目录句柄，点击最近项目时先请求权限再进入会话队列。

文件夹绑定会保存目录句柄、工程路径和每个目标文件的 SHA-256 基线。保存时只写实际变化的文件；外部变化、缺失或新增冲突会阻断写回。写入中途失败时，已尝试文件按逆序恢复。没有可写目录句柄时保留浏览器工作区，并提示重新授权或选择项目目录。

## 发布与预览

发布只读取已保存的检查点。存在未保存修改时会阻断发布，避免运行时包与当前 UAM 不一致。发布结果写入工作区 `.fairygui-runtime/`，随后卸载旧包、回收 Blob URL 并刷新运行时预览。

`TestView`、弹出窗口、工具提示、设备方向和适配设置是本地调试状态，不进入工程历史。静态运行时包仅作为工作区没有运行时包时的回退。
