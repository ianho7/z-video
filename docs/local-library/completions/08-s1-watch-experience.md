# S1 完成记录：观看标记与外观收口（Ticket 21、22a、22b）

Date: 2026-11-15
Integration branch: `codex/experience-backlog`
合入链：`5fa84ed`（21）→ `ab74ecb`（22a）→ `e6645b2`（22b）
Spec: `docs/local-library/spec-s1-watch-experience.md`

## 交付

| Ticket | 结果 | 证据 |
|---|---|---|
| 21 外观一致性 | 自绘滚动条（普通/hover/active）、`summary` 自绘标记、应用内 tooltip 取代 5 处原生 `title`、`::selection` 与 focus ring 统一；含 overlay 镜像 | typecheck、125 单测、`test:window`、`test:appearance-window`、`test:player-overlay-window` 全过 |
| 22a Marker 存储与展示 | schema v4→v5 新增 `markers` 表（PK `(media_id, position_sec)`，级联删除）；`local-library:markers-list/add`；播放器 `B` 打点；进度条刻度层（无标记不渲染） | typecheck、125 单测、`test:local-library`、`test:player-window`、`test:local-library-app` 全过 |
| 22b Marker 交互 | `local-library:markers-remove`（幂等，未知秒返回 false）；刻度改为可点击按钮，点击 seek；选中后一次确认删除；失败保留刻度并提示；overlay 镜像刻度与删除控件 | typecheck、125 单测、`test:local-library`、`test:player-window`、`test:player-overlay-window` 全过 |

## 断言变更（逐条）

- `tests/local-library-contract.test.ts`：schema `4 → 5`；表清单新增 `markers`。
- `tests/local-library-database-smoke.ts`：全部 schema 版本期望 `4 → 5`（含 v1/v2/v3 迁移与幂等块）；v1 夹具补 `DROP TABLE markers` 并断言迁移后存在；新增标记 CRUD、同秒幂等、排序、拒绝、级联、v4→v5 迁移幂等断言。22b 把"重启后 [30,90]"改为"删除 90 后重启仍 [30]"。
- `tests/player-window-smoke.ts`：新增无标记无刻度、`B` 记录整秒且不暂停、两个刻度升序、失败写入无幽灵刻度；22b 新增点击 seek、删除、失败保留、以及把"失败后刻度数 2"改为 1（流程中已删除一个）。
- `tests/player-overlay-window-smoke.ts`：新增刻度镜像数量/位置、overlay 点击 seek、`--progress` 同步、overlay 删除后两侧归零。
- `tests/appearance-window-smoke.ts`：旧断言依赖 renderer 上不存在的 appearance dataset，改为在 main owner 观察同一事实；IPC stub 从旧 NAS 通道改为当前 local-library 通道；保留并加严最小窗口尺寸。理由见 Ticket 21 报告与 G-02。

## 已知边界

- 像素级观感、DWM/acrylic、真实媒体、macOS 未验收。
- overlay 其它 inline style 镜像（如 ended 面板 `--remaining`）仍会被 CSP 丢弃，属既有问题，本批只修进度条与标记路径。
- `parseMarkerDeleteInput` 的字段白名单没有独立单测（与 add parser 同构，worker/DB 冒烟覆盖校验语义）。
- G-02（`appearance:state` 无 renderer 消费者、acrylic 被不透明底色遮挡）仍未实现，不在本批范围。

## 下一批

S2 变更感知：23a（增量扫描与四类计数）→ 23b（回库自动刷新）→ 24a（本地监听）→ 24b（网络盘轮询）。
审计遗留的高优先级问题 B-05（`rescanAll` 忽略取消）与 G-01（无单实例锁）仍待成票，建议排在 S2 之后。
