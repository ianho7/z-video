# 状态机与并行实施规则

改状态机、epoch、或并行分派子代理时读。状态台账在 `docs/local-library/state-machines.md`。

## 状态机

- 一个语义状态只能有一个载体和一个写入点；用超过两个布尔表达同一状态时收敛为判别联合或枚举。
- 状态集合变化时同步更新 `docs/local-library/state-machines.md` 台账。
- 契约中声明但没有生产者的状态（如曾经的 `PlaybackEvent.buffering`、`SessionStatus.restoring`）必须删除或在台账标注。
- 落库的"进行中"状态必须有显式列、启动修复路径和可查询入口；只写不读的 in-flight 标记视为未实现。
- 请求代际（epoch/generation）按语义域隔离，禁止一个计数器守卫多个域。
- 视图与面板可见性由单一状态派生，禁止多处分别写 `hidden`。
- 每个状态机对应一个纯 `transition(state, event)`；非法迁移用穷尽 `never` 分支拒绝，并为非法路径写单测。
- 修改既有测试断言时，在完成记录中逐条列出旧值、新值和理由。

## 并行实施

- 按文件白名单切通道；子代理只写自己的工作树，不写主工作树。
- `npm run build` / `npm test` 由集成侧独占；子代理只允许 `npx tsc -p <config> --noEmit`。
- 合并前检查主工作树 `git status`；出现非预期脏文件先还原再合并。
- 不要相信子代理的口头结论；验收证据以截图、数据库或命令输出为准。
