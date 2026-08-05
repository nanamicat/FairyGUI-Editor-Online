# FairyGUI Editor Online

FairyGUI Editor Online 是一个运行在浏览器中的 FairyGUI 工程编辑器。它使用 OpenFairyGUI 读取和修改编辑工程，以冻结的 LayaAir 3.3.10 与 FairyGUI Web 运行时提供画布和运行时预览。

## 项目愿景

项目目标是建设一个可独立使用和持续演进的开源 FairyGUI 浏览器编辑器，而不是桌面编辑器的在线外壳或 OpenFairyGUI 的验证界面。

- **浏览器优先**：在现代浏览器中完成工程导入、编辑、保存、发布和预览，不依赖 LayaAir IDE 或本地服务桥接。
- **本地优先**：工程默认保存在用户浏览器或用户明确授权的本地目录中，不要求上传到远程服务。
- **格式兼容**：以标准 `.fairy` 工程和 OpenFairyGUI 统一编辑模型为事实来源，保持与现有 FairyGUI 工具链的互操作性。
- **可靠编辑**：所有修改统一经过校验、事务、撤销/重做和保存后验，优先保证工程数据不丢失。
- **受控扩展**：通过权限明确的浏览器插件扩展菜单和面板，同时隔离工程文件、浏览器存储与页面环境。

## 功能

- 从本地文件夹或 ZIP 导入 FairyGUI 工程。
- 浏览包、组件、资源与显示列表。
- 在画布和属性检查器中编辑对象，支持多选、对齐、排列、复制、删除、层级调整和组件导航。
- 编辑控制器、动效、关联、齿轮属性、资源和项目发布设置。
- 统一撤销/重做、未保存状态检查点、浏览器工作区保存与刷新恢复。
- 将工程发布为 `.fairygui-runtime`，并在测试视图中预览。
- 在支持 File System Access API 的浏览器中安全写回绑定目录；其他环境可导出 ZIP。

## 技术栈

| 类别 | 框架或库 | 用途 |
| --- | --- | --- |
| 开发语言 | TypeScript 5.9，严格模式 | 编辑器、命令、存储和浏览器交互代码 |
| 构建工具 | Vite 8 | 开发服务器、TypeScript 编译与 Web 构建 |
| 编辑模型 | OpenFairyGUI 0.2.2 | `.fairy` 工程读写、统一编辑模型、事务、保存与浏览器发布 |
| 渲染引擎 | LayaAir 3.3.10 Web 运行时 | 舞台、渲染和输入事件；版本冻结，不依赖 LayaAir IDE |
| 界面运行时 | FairyGUI-Layabox | 编辑器界面、画布对象和运行时组件显示 |
| 压缩处理 | fflate 0.8.3 | 浏览器内 ZIP 导入与导出 |
| 浏览器能力 | OPFS、IndexedDB、File System Access API、Web Workers、Web Locks | 本地存储、目录写回、插件隔离与并发保护 |

项目不使用 React、Vue 等 DOM 界面框架；编辑器界面由 FairyGUI 组件构建，Vite 直接编译 `src/Main.ts` 及其 TypeScript 模块。

## 本地运行

需要 Node.js `>=22.18.0`。

```powershell
git submodule update --init
npm install
npm run dev
```

开发服务器默认监听 `http://127.0.0.1:5173`。

## 构建与检查

```powershell
npm run typecheck
npm run build
npm run preview
```

提交由依赖生成的快照和运行时文件前，先执行：

```powershell
npm run generate
```

编辑器自身的 `Basic` / `Builder` 二进制界面包由官方 UI submodule 发布：

```powershell
npm run publish:editor-ui
```

该命令调用 OpenFairyGUI CLI，并通过 `--project-type layabox` 发布到 `assets/resources/ui/`；不会修改 submodule 源文件。

维护者可运行完整回归：

```powershell
npm run verify
```

回归脚本位于 `scripts/internal/`。完整验证会重新生成发布所需的快照和运行时文件，并把报告写入已忽略的 `verification/reports/`。默认测试工程是 `samples/FairyGUI-layabox/demo/UIProject/FairyGUI-layabox-demo.fairy`，由官方 submodule 提供；也可通过 `FAIRYGUI_AUTHORING_PROJECT` 指向其他 `.fairy` 工程。

## 目录

- `src/`：编辑器应用、命令、服务与界面控制器。
- `assets/`：Vite 静态输入、冻结运行时和编辑器资源。
- `vendor/FairyGUI-Editor/`：官方 FairyGUI Editor 仓库 submodule；界面工程位于其 `ui/` 子目录。
- `samples/FairyGUI-layabox/`：官方 FairyGUI-Layabox 仓库 submodule；`demo/UIProject` 是默认编辑工程。
- `scripts/`：资源生成、发布准备和内部回归工具。
- `docs/`：产品架构与维护文档。

## 数据边界

工程文件默认保存在浏览器 OPFS，OPFS 不可用时降级到 IndexedDB。目录写回会先比较导入或上次成功写回时记录的 SHA-256 基线；检测到外部修改时停止覆盖并保留浏览器工作区。ZIP 导入不会直接修改原文件。

更多信息见 [项目文档](./docs/README.md)。

## 项目来源与许可证

本项目最初基于 LayaAir Editor 生成的工程结构建立，当前 Web 开发与构建使用 Vite，不依赖 LayaAir Editor；浏览器运行时继续使用仓库中冻结的 LayaAir Web 运行时。

编辑器界面工程通过 `vendor/FairyGUI-Editor/` 关联官方 [FairyGUI Editor UI 仓库](https://github.com/fairygui/FairyGUI-Editor)，实际发布输入为 submodule 内的 `ui/`，生成的界面包位于 `assets/resources/ui/`。在线编辑器专属的可见性、文案和图标缩放由 TypeScript 运行时补齐，不修改 submodule。默认示例工程通过 `samples/FairyGUI-layabox/` 关联官方 [FairyGUI-Layabox](https://github.com/fairygui/FairyGUI-layabox)，同样不修改 submodule。

本项目使用的编辑器 UI 工程已取得 FairyGUI 官方口头授权，但该授权不构成通用商标许可，也不自动延伸至 fork、衍生项目或其他第三方。软件许可证不授予 FairyGUI 名称、Logo 或其他品牌标识的使用权；具体边界见 [商标与品牌使用政策](./TRADEMARKS.md)。

本项目原创代码使用 [MIT License](./LICENSE)。LayaAir、FairyGUI、OpenFairyGUI 及其他第三方代码和资源保留各自的版权与许可，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
