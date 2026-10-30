# Ticket 02 完成记录：Electron 片库、详情与真实续播映射

记录范围：`codex/electron-02`，基于集成 tip `46f4fcf`。本票据只负责
NAS library/detail/image mapping、library/navigation controller 和
library/detail renderer；native player、Electron 依赖升级和播放器模块仍由
Ticket 03 负责。

## 实现结果

- `src/main/nas-client.ts` 新增真实 collection list、collection detail、旧
  history fallback 和 image binary 请求。普通列表默认 `system=94`，仅在
  空列表时尝试 `system=7`；缺少 `data.list` 报 malformed，不转成空片库；
  年份、评分、Episode 编号/时长和 history 数值兼容 JSON number/string。
- `src/main/library-controller.ts` 负责 main-only session access、分页页缓存、
  详情缓存、8 MiB/64 项 LRU 图片缓存、局部搜索/类型筛选/标题/评分/上映年份排序、请求代次、
  navigation context 和 renderer-safe DTO 映射。`file_path`、token、`nas_sign`
  和媒体 URI 不进入 renderer；图片通过 main 请求后转为 data URL。
- `src/shared/contracts.ts`、`src/shared/ipc-channels.ts`、`src/preload/preload.ts`
  和 `src/main/ipc.ts` 增加了经过验证的 library/navigation channels。共享
  `player` bridge 仅保留可选 additive 类型，未实现播放器成功假象。
- `src/renderer/library.ts`、`library.css` 和 `index.html` 实现真实列表/分页、
  loading/empty/error 区分、搜索/filter/sort 覆盖范围说明、详情/选集、Esc/返回、
  滚动与 focus 恢复和仅由已读 NAS history 生成的继续观看条目。详情播放按钮只
  在可选 player bridge 存在时发送 `PlaybackCommand.open`。
- `tests/window-smoke.ts` 扩展到登录 → 片库卡片 → 详情/Episode 的真实
  `BrowserWindow` interaction。`docs/electron-migration-contracts.md` 记录了
  Ticket 02 的共享契约 additions。

## 行为保持修复（2026-10-31）

- 恢复现有 Rust 片库查询的 `score_desc` 和 `release_year_desc` 排序值，贯穿
  `LibraryQuery`、IPC 校验、主进程已加载页排序、UI 选项和导航恢复；评分/年份缺失值
  排在有值之后，同值按片名再按 collection id 稳定排序，与现有 Rust helper 一致。
- 新增一个 owner-boundary 参数化 controller test，覆盖两种排序、数字降序、缺失值和
  同值 tie；未重跑未受影响的 real-window route evidence。

## 验证

| 命令 | 结果 | 覆盖/边界 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | main/preload/renderer TypeScript 类型检查 |
| `node --test dist/tests/library-controller.test.js` | 通过，3/3 | 片库 owner boundary；含评分/上映年份排序回归 |
| `npm test` | 通过，20/20 | Ticket 01 owner tests、NAS library/detail protocol tests、controller mapping/cache/unauthorized tests；使用本机 HTTP fixture，不证明真实 NAS |
| `npm run test:window` | 通过 | 真实 Electron BrowserWindow、隔离 renderer、登录 → library → detail/Episode；fixture IPC，不证明实时 NAS。命令通过 `ELECTRON_OVERRIDE_DIST_PATH` 复用 `electron-01` 已存在 runtime |
| `git diff --check` | 通过 | 当前变更无 whitespace error |

本地窗口命令实际使用：

```powershell
$env:ELECTRON_OVERRIDE_DIST_PATH = 'D:\project\z-video\.worktrees\electron-01\node_modules\electron\dist'
npm run test:window
```

## 未完成/限制

1. 没有读取私有凭证或连接用户 NAS；真实分类、分页、详情、封面、Episode、
   history 和请求参数仍需在获准环境按独立验收流程验证。
2. Ticket 03 尚未提供 native player IPC/engine；本票据保留 player mount 和
   `PlaybackCommand` 类型，不声称播放、流解析、音轨/字幕、进度写回或硬解已通过。
3. `npm test` 使用了已存在的 Electron runtime override；没有下载或修改另一
   worktree 的依赖。Rust 未改动，未重跑已知离线缺依赖的 Cargo 检查。
4. 搜索、类型筛选和标题/评分/上映年份排序明确标为 `loaded-page`；没有把单页数据宣称为全库，
   也没有逐条轮询 NAS 详情来制造继续观看。

## 文件责任

- Ticket 02 owner：`src/main/library-controller.ts`、library portions of
  `src/main/nas-client.ts`、`src/renderer/library.ts`、`src/renderer/library.css`
  及对应测试。
- Shared additive edits for merger：`src/shared/contracts.ts`,
  `src/shared/ipc-channels.ts`, `src/main/ipc.ts`, `src/main/main.ts`,
  `src/preload/preload.ts`, `src/renderer/index.html`, `src/renderer/renderer.ts`,
  `scripts/copy-renderer-assets.mjs`, `tsconfig.renderer.json`, and
  `tests/window-smoke.ts`. Player agent may extend the same shared files; preserve
  these library channels and the player mount when resolving conflicts.

本次修复提交后已合入最新 `codex/electron-integration` 文档 tip `77ced0c`；最终工作树
HEAD 由合并提交记录，未改变 player-owned 文件或依赖。

