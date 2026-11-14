# worker 生命周期与缓存初始化

ID: 13-worker-lifecycle
Depends: none
Priority: P1

## What to build

让 utilityProcess / SQLite owner 的崩溃与重启在状态上可见、可恢复，并修掉两处不可恢复的闩锁。

- `handleWorkerExit` 必须更新 `state`（例如 `status:"error"` + `sqlite-unavailable`），并通知 renderer；不得继续返回 `status:"ready"`。
- 非预期退出（含 `code === 0`）统一 `failPending`，杜绝永久 pending。
- `LocalLibraryDatabase.call()` 增加超时（可取消的 promise），超时以稳定错误码 reject，避免渲染层 `sourceBusy` 永久为真。
- worker 崩溃后允许一次受控重启（例如下次 `list`/`scan` 前自动 `start()`），重启失败则保持 error 状态并暴露可读原因。
- `LocalArtworkCache.initialized` 失败后可重试（不要永久 rejected promise）；并发同 `cacheKey` 合并为一次读源（按 key 的 in-flight map）；磁盘淘汰至少与"最近使用"一致（读命中时 touch）。

## Acceptance criteria

- [ ] 模拟 worker 退出（非 0 与 0 两种）：`getState()` 不再报 ready，pending 请求全部 reject，无挂起。
- [ ] `call()` 超时后渲染层能结束 busy 态并给出可读错误。
- [ ] 崩溃后下一次片库操作触发一次重启；重启成功则恢复可用，失败则错误状态稳定可见。
- [ ] 封面缓存初始化失败（目录不可创建）后可再次成功初始化。
- [ ] 同一 `cacheKey` 并发 4 次请求只读源一次、只解码一次。

## Out of scope

- 多 worker / 进程池。
- 缓存容量策略调整。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
`tests/local-artwork-cache.test.ts` 需覆盖新的重试与去重路径。
