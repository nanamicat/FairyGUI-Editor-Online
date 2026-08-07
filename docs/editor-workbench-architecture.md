# Editor Workbench 模块架构

当前项目既是 FairyGUI 在线编辑器，也是同技术栈编辑器产品的参考实现。模块化的目标是让不同产品显式组合可信功能，同时保留 UAM、事务、历史和浏览器插件的安全边界；它不是把当前私有应用直接发布成 SDK。

## 分层

```text
EditorWorkbench
  ├─ trusted product modules
  │    ├─ fairygui.authoring-preview
  │    ├─ fairygui.editor-shell
  │    ├─ fairygui.browser-plugins
  │    └─ fairygui.resource-health
  └─ EditorShell
       └─ trusted contribution host

fairygui.browser-plugins
  └─ BrowserPluginHost
       └─ sandboxed iframe + Worker plugins
```

- `EditorWorkbench` 只管理模块状态、启动顺序、服务所有权、依赖保护和逆序清理。
- 可信产品模块运行在应用上下文中，可提供服务或注册 UI contribution。
- `EditorShell` 继续承载当前桌面编辑器的 UAM/session/history/selection 编排；写操作仍必须经过既有 transaction 路径。
- `BrowserPluginHost` 继续使用 iframe + Worker 沙箱和显式权限。外部插件不能因为内部模块化而获得 DOM、OPFS handle、backend session 或 live UAM。

## 生命周期

模块只实现一个最小契约：

```ts
interface EditorModule<THost> {
    id: string;
    hotReloadable?: boolean;
    activate(context: EditorModuleContext<THost>): void | (() => void) | Promise<void | (() => void)>;
}
```

`activate` 返回的清理函数以及 `context.onDeactivate()` 注册的清理函数会按逆序执行。`provideService()` 提供的服务归当前模块所有，模块停用时自动移除。消费者通过 `requireService()` 形成实际依赖；提供者仍被活动消费者使用时，Workbench 拒绝热拔出。

启动后的 `attach(module)` 会安装并激活一个新可信模块；激活失败时不会留下半安装记录。`detach(id)` 会先执行完整清理，再移除模块定义。预装模块可以用 `deactivate` / `activate` 暂停和恢复，也可以用 `reload` 原地重启。

不引入依赖解析器、DI 容器或远程可信模块安装。产品入口按代码顺序显式装配模块，启动失败会回滚本轮已经激活的模块。

## 当前产品组合

`FairyGuiEditorProduct` 当前按以下顺序启动：

1. `fairygui.authoring-preview`：提供 `RuntimePreviewController` factory，使其他同栈产品可以替换预览实现而不修改 Shell 构造逻辑。
2. `fairygui.editor-shell`：构造现有在线编辑器 Shell，并提供可信 UI contribution host；它绑定当前 `Builder/MainView` 生命周期，不允许单独热重载。
3. `fairygui.browser-plugins`：拥有外部插件 Host、管理菜单、动态 contribution、插件弹窗和 sandbox 生命周期；模块停用时统一撤销和清理。
4. `fairygui.resource-health`：通过 contribution host 注册“资源健康”工具菜单，可独立 deactivate、activate 或 reload。

不同方向的编辑器可以复用 `EditorWorkbench`，用自己的 host 和模块列表替换 `fairygui.editor-shell`。需要共享现有 FairyGUI Shell 时，则复用当前产品模块并增删叶子模块。

## 热拔插等级

| 能力 | 生命周期 |
| --- | --- |
| 菜单、命令、独立工具、Inspector 扩展 | 可即时 deactivate / activate / reload |
| Preview、Timeline、Publish、Test 等持有运行时资源的模块 | 必须先 dispose 自己的 listener、package lease、Blob URL 和 pending task，再顺序替换 |
| Workspace/storage/backend session provider | 仅允许在工作区 clean 且消费者已停用后替换 |
| Laya stage、FairyGUI 全局 runtime、UAM/history kernel、`Builder/MainView` root | Workbench 或页面生命周期替换，不承诺单模块热拔插 |

Vite HMR 是开发期代码更新；Workbench 的 activate/deactivate/reload 是产品运行期模块生命周期，两者不混用。

## 新模块规则

1. 模块 ID 使用小写命名空间，例如 `maker.agent-observation`。
2. 所有 listener、弹窗、计时器、Blob URL、runtime package lease 必须归模块 scope，并在 deactivate 时释放。
3. 模块不得直接写 UAM；写入仍走统一 transaction、preflight、history 和 Save checkpoint。
4. 可选模块使用 contribution/service；不要从 `EditorShell` 取得原始 Controller 逃生口。
5. 只有真实第二个产品需要跨仓库同步版本时，再把稳定模块移动到独立 `@openfairygui/*` 包；当前仓库继续保持 `private`，不增加 export 构建。

## 验证

`scripts/internal/verify-editor-workbench.mjs` 覆盖：

- 显式启动顺序和服务依赖记录；
- 活动消费者存在时阻止拔出提供者；
- 叶子模块 deactivate / activate / reload；
- 运行时 attach / detach 以及 attach 失败回滚；
- LIFO cleanup 和服务自动移除；
- 启动失败回滚；
- 当前产品确实从 Workbench 启动，并通过模块注册 Authoring Preview 与 Resource Health。
