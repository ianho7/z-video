# 人工验收：DSH 调用 Codex computer use

用于需要真实窗口、真实鼠标/键盘或 overlay 点击的验收。目标是可复核的证据链，而不是"agent 说通过了"。示例产物见 `docs/local-library/evidence/e2e-2026-11-15/`。

## 平台检查

- LCU 在 Windows 没有交付物；不要围绕 LCU 排期。
- 改走 Codex CLI 自带的 cua（`cua_repl` / `node_repl`），无需 LCU。

## 前置检查（按顺序，任一步失败先修）

1. `codex --version` 能跑。
2. `codex exec -m <model> "reply ok"` 做一次最小调用，确认模型可用。
3. 模型不可用时：升级 CLI（`codex update`），清 `~/.codex/models_cache.json` 后重试。
4. 确认 `~/.codex/computer-use/config.toml` 的目标应用在 `apps.allowed` 里；不在就先加，否则 cua 看不到窗口。

## 启动被测应用

- 用隔离 profile：`--user-data-dir=<临时目录>`，避免读写用户真实数据。
- 加 `--force-renderer-accessibility`，让 UIA 能读到控件树。
- 启动前清除 `ELECTRON_RUN_AS_NODE`（见 [pitfalls.md](pitfalls.md)）。

## 驱动方式

- 导航/按钮：UIA `InvokePattern`（元素级，不依赖坐标）。
- 键盘（如播放器 `B` 打点）：`WScript.Shell.AppActivate(pid)` 确认前台，再 `SendKeys`。
- overlay 上的控件（播放器刻度、删除标记等）：UIA 点击会被 overlay 拦截，改用 Codex cua 点；这是唯一必须消耗 Codex token 的场景。
- 合批操作，加 `-c model_verbosity="low"`；确定性步骤不要逐步起 `codex exec`。

## 取证

- 截图：PowerShell `GetWindowRect` + `CopyFromScreen`，按窗口矩形抓取（不是整屏）。
- 播放器截图前把鼠标移到控制条，等控件显示后再截。
- 每步写 `manifest.json`：步骤 → 截图文件 → 断言 → 数据库快照/查询结果。失败步骤如实记录，不得写成通过。

## 交叉验证

- 直接读隔离 profile 的 `library.sqlite`：`markers`、`media_files`、`collections`（以及 `playback_state`）。
- 截图与数据库都要有；只有截图或只有口头结论不算证据。

## 证据目录

- 路径：`docs/local-library/evidence/e2e-<date>/`，含 `README.md`（覆盖范围、操作方式、已知限制）与 `manifest.json`。
- 截图用稳定英文名（如 `u04-play.png`），README 表格逐行对应步骤、截图、结果、数据证据。
- 不保留可重放脚本时，在 README 里说明驱动脚本位置（如临时目录）与不随仓库保留的原因。

## 限制

- 窗口截图不等于像素级视觉验收；颜色/字体仍需人眼判断。
- macOS 与 SMB/网络盘需单独验证，不能用 Windows 本地盘结论替代。
- 依赖 cua 的步骤要标明；其余步骤应可在不消耗 Codex token 的情况下复现。
