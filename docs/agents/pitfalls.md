# 已验证陷阱（2026-11 本 Session）

每条都是实际导致过重复/耗时错误的模式。先对照本文件，再决定"产品缺陷"还是"环境/夹具问题"。

## Electron CLI 环境

- 本机 shell 常带 `ELECTRON_RUN_AS_NODE=1`。它会让 `electron.exe` 退化为 Node，并报 `bad option: --disable-gpu`。
- 规则：所有 Electron/冒烟命令前先清除该变量（如 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`），再启动。

## 并发构建

- 多个子代理同时 `npm run build` / `npm test` 会互相踩 `dist/`，产生假失败。
- 规则：集成侧独占 build/test；子代理只用 `npx tsc -p <config> --noEmit`。

## 文件所有权

- 并行子代理必须只写自己的工作树。曾出现子代理把半截改动写进主工作树，导致集成侧构建假失败。
- 规则：合并前先看主工作树 `git status`；有非预期脏文件先还原，再合并。

## 测试不得依赖随机 ID

- 清理队列曾用随机 `mediaId` 做同尺寸 tie-break，导致 50/50 flaky。
- 规则：断言和排序用稳定键（标题等），不用随机/生成 ID 的排序结果。

## 窗口冒烟需要"已合成"前提

- 锁屏/显示器休眠时窗口不产帧，IntersectionObserver 不回调，懒加载断言会假失败。
- 规则：夹具先 `show/focus/moveTo` 并等待一帧，确认窗口可见后，再断言懒加载/渲染结果。

## 夹具会过期

- renderer/IPC 契约变更后，旧 stub 会驱动已退役通道。
- 规则：失败先判断"产品缺陷 vs 夹具过期"；修夹具要修到能证明当前行为，而不是放宽断言。

## overlay 会拦截坐标点击

- 播放器上方的 overlay 窗口会吃掉针对主窗口元素的坐标点击。
- 规则：UI 自动化优先元素级 `InvokePattern` 或键盘；点击失败不能据此判定产品"点击无效"。必须点 overlay 时改用 Codex computer use（见 [codex-computer-use.md](codex-computer-use.md)）。

## 前台锁

- `SetForegroundWindow` 常被 Windows 前台锁挡住，`SendKeys` 会发到别的窗口。
- 规则：先 `WScript.Shell.AppActivate(pid)`，确认在前台后再发键。

## 不要相信子代理/Codex 的口头结论

- 曾出现 Codex 说"播放已结束"（实际仍在播）、说"删除失败"（数据库已删空）。
- 规则：每条结论必须有截图、数据库查询或命令输出佐证；无证据即未验证。

## 先验证工具可用再规划

- 模型/工具可能因账号或版本不可用：`gpt-6.1-terra` 曾被 ChatGPT 账号拒绝；LCU 没有 Windows 构建。
- 规则：先用一次最小调用确认，再谈方案。

## Codex token 经济

- 不要每步一次 `codex exec`。确定性操作（导航、按键、读库、截图）用 UIA / SendKeys / PowerShell 完成。
- 只有 overlay 这类必须的交互才用 Codex，并尽量合批，加 `-c model_verbosity="low"`。
