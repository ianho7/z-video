# 遗留路径标注（不删除）

ID: 16-legacy-deprecation
Depends: none
Priority: P3

## What to build

按 AGENTS.md 的 rollback/reference 要求，保留 NAS 遗留实现，但在代码与文档上明确其不在默认运行路径，避免后续开发误认为登录流程仍存在。

- 输出清单：模块、被谁使用（仅测试/无人使用）、是否可删。
- 对以下模块在文件头加 `@deprecated` 说明与取代者：
  - `src/main/ipc.ts`、`src/main/session-controller.ts`、`src/main/library-controller.ts`、`src/main/discovery.ts`、`src/main/secure-session-store.ts`、`src/main/nas-client.ts`
  - `MainPlaybackHost`（`src/main/player-host.ts` 内）
  - `src/preload/preload.ts` 的 `session` / `library` / `discovery` / `player` / `appearance`
- `src/renderer/library.ts`：确认未被 `index.html` 引用后，在文件头标注"仅编译未运行"；如确认零引用且测试不依赖，单独提出删除建议（不在本 Ticket 删除）。
- `docs/architecture.md` 与 `docs/local-library/state-machines.md` 记录"活路径 vs 遗留路径"。
- 记录死状态：`SessionStatus.restoring/authenticating`、`PlaybackEvent.buffering`、`searchPage`（若 Ticket 12 已修则移除）、`html[data-motion]` 手动档位。

## Acceptance criteria

- [ ] 清单落盘，明确每项的使用者与删除条件。
- [ ] 标注不改运行时行为，`npm test` 全绿。
- [ ] 至少在 `docs/architecture.md` 有一处指向清单的链接。
- [ ] 未删除任何遗留文件或测试。

## Out of scope

- 删除遗留代码。
- 恢复/完善 NAS 登录流程。

## Verification

`npm run typecheck` → `npm test`（纯注释与文档改动）。
