# Soft Cinema execution

设计依据：[spec.md](spec.md)。只改 renderer 与随包字体，不改 IPC/DTO/schema。

## DAG

```
01-foundation ──┬─> 02-cover-color ──┬─> 03-home ──┬─> 04-all-media ─┐
                │                    │             └─> 05-sources ────┤
                │                    └─> 06-detail ──> 07-player ─────┤
                └────────────────────────────────────────────────────> 08-states-acceptance
```

| Ticket | 依赖 | 可并行 |
|---|---|---|
| 01-foundation | — | — |
| 02-cover-color | 01 | — |
| 03-home | 01, 02 | 06 |
| 04-all-media | 03 | 05, 06, 07 |
| 05-sources | 03 | 04, 06, 07 |
| 06-detail | 02 | 03, 04, 05 |
| 07-player | 01, 06 | 04, 05 |
| 08-states-acceptance | 04, 05, 07 | — |

## 通用约束

- 每个 ticket 先读 spec.md 对应章节和原型画板。
- 不新增 IPC channel、DTO 字段或 schema；需要时停下来记录，不擅自扩展。
- 保留或同步更新 window smoke 用到的 DOM id（spec §8）。
- 完成说明写到 `docs/design/soft-cinema/completions/<ticket>.md`：改了什么、验证命令与结果、Windows 截图、未验证项（macOS 等）。
