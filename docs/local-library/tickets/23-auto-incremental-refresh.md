# 回库自动增量刷新

ID: 23-auto-incremental-refresh
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

改完 NFO 或增删文件后，回到片库就能看到正确结果，不再需要手动点重新扫描；并且只处理变化，不做全树重扫。用户可感知结果：编辑 NFO 后切回应用即生效。

- 增量扫描能力：按目录或路径重扫，返回精确的 `imported / updated / unchanged / removed` 计数。
- 触发点：窗口重新聚焦或从详情/播放器返回片库时做一次轻量校验（先看 size/mtime，不读 XML）。
- 自动扫描不覆盖用户正在进行的操作，也不产生"更新了全部条目"的噪音。

## Acceptance criteria

- [ ] 修改一个 NFO 后回到片库，条目在无需手动扫描的情况下更新。
- [ ] 自动刷新只重扫变化范围，20k 库不做全量遍历。
- [ ] 结果计数区分 imported / updated / unchanged / removed。
- [ ] 用户正在详情或播放时，刷新延后而不是丢弃。
- [ ] 扫描结果与手动重扫一致。

## Out of scope

- 文件系统监听与网络盘轮询（Ticket 24）。
- 片库 UI 改版。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
