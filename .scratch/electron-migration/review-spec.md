# Electron migration Spec-axis review

Review range: `1c0ab0b865abe80a47796f1de278374d85754b78...deae61a3d8da3fa72b81e5672ecb1a91234066c9` (72 files, non-empty; worktree clean).

## Findings

### (a) Requirements missing/partial

- **P2 — 搜索未按批准交互实现。** `src/renderer/library.ts:426-432` 只有 submit 才调用 `loadCollections`，`input` 处理器只切换清空按钮。违反 `docs/design/spec-03-browsing-flow.md:31` 的“查询输入及时反馈，后台请求防抖、支持Enter立即提交”。

### (b) Unasked behavior

- 未确认到超出批准 Ticket/设计的行为；发现的路径均属于登录、浏览、播放或打包范围。

### (c) Wrong behavior

- **P1 — 私密媒体路径穿过 renderer。** `src/main/nas-client.ts:296-307` 将 `file_path`/`url` 作为 `stableId`，`src/main/library-controller.ts:122-125` 原样映射为 renderer 的 `episodeId`。违反 `docs/electron-migration-contracts.md:32-33`：“uses `episodeId`, not a private NAS `file_path`”及 `:69-72` 的 DTO 禁止 private `file_path`/media URI；path-only Episode 会进入 DOM/IPC，并可回传 PlaybackCommand。
- **P1 — 登出/换账号会混用播放会话。** `src/main/ipc.ts:23` 只清 Session；`src/renderer/renderer.ts:353-359` 未关闭播放器。播放解析在 `src/main/player-host.ts:98-106` 捕获旧 Session，而进度上报 `:120-135` 每次读取当前 Session；登出后登录账号 B 可把账号 A 的活动目标进度写给 B。违反 `.scratch/electron-migration/issues/04-nas-resume.md:11` 的“associate correct Account/Collection/Episode”。
- **P1 — 继续观看丢弃 Episode 身份。** `src/renderer/library.ts:142-144,403-406` 不渲染/传递 `ContinueWatchingItem.episodeId`，只打开 Collection。违反 `docs/design/spec-03-browsing-flow.md:19-20`：“进入对应详情与选集”并“恢复正确位置”。
- **P2 — 过期详情响应仍覆盖 main 导航。** `src/main/library-controller.ts:304-330` 的 `getDetail` 没有代次检查，晚返回的旧请求仍写入 `this.navigation`。违反 `docs/electron-migration-spec.md:41` 的“prevent stale navigation results”及 `docs/design/spec-03-browsing-flow.md:31` 的“旧结果失效”。

## Acceptance gaps (not counted as findings)

`.scratch/electron-migration/05-completion.md:70-91` 已明确：尚无真实 NAS 流/进度响应/重启读回；硬解、混合 DPI、DWM 像素、macOS、native overlay 视觉差异和公共 license provenance 仍未验证。现有本地窗口、DPAPI、包加载/EXE 存活证据不应扩写为这些能力已通过。
