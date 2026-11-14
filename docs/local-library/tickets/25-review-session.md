# 连续复查会话（含决策预算）

ID: 25-review-session
Blocked by: 15
Status: ready-for-agent

## What to build

把现有单例检查模式扩成一次连续会话：做出决定后自动进入下一个候选，可撤销上一步，结束时给出汇总；并限制单次会话的决策数量，避免疲劳误判。用户可感知结果：一次坐下来能连清几十个条目。

- 会话状态：idle → reviewing → deciding → summary。
- 单键决定 keep / snooze / delete-candidate，决定后自动下一个。
- 撤销上一步（记录 `{mediaId, previousState}`）。
- 会话预算（默认 20 个）与结束汇总（处理数、释放空间）。
- 复用现有清理标记写入路径，不新增后端。

## Acceptance criteria

- [ ] 连续处理 ≥20 个候选，每个决定都持久化。
- [ ] 撤销能恢复上一步的清理标记与卡片状态。
- [ ] 到达预算上限时给出汇总并回到队列。
- [ ] 中途返回不丢已做的决定，也不残留会话状态。
- [ ] 退出会话后整理页状态与进入前一致（除已完成标记）。

## Out of scope

- 三秒卡片与关键帧（Ticket 27）。
- 队列到期与配额（Ticket 30）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library-app`。
