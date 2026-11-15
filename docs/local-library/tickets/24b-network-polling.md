# 网络盘轮询

ID: 24b-network-polling
Blocked by: 24a
Spec: docs/local-library/spec-s2-change-detection.md
Status: ready-for-agent

## What to build

网络共享上的变化在合理周期内反映，即使系统不提供可靠的文件事件。

- 判定 UNC 路径或映射网络驱动器。
- 低频目录 mtime 轮询（默认 5 分钟），仅应用在前台时进行。
- 只把 mtime 变化的目录交给增量扫描，不做全库遍历。
- 明确不承诺秒级；监听路径不可用时它仍是兜底。

## Acceptance criteria

- [ ] 网络盘新增/删除文件后，在一个轮询周期内反映。
- [ ] 轮询只检查已知目录的 mtime，不遍历文件树。
- [ ] 应用在后台时不做轮询。
- [ ] 网络盘不可达时不误报为"来源可用"，也不刷屏报错。
- [ ] 网络盘不会被误判为本地盘而挂上无效监听。

## Out of scope

- 网络盘实时监听。
- 轮询周期可配置（先用固定默认值）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`（用本地临时目录模拟，不接触真实共享）。
