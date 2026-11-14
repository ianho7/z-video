# 心率联动 POC

ID: 35-heart-rate-poc
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

用华为手环 9 的"心率广播"验证 Windows 侧能否稳定读到标准 BLE 心率。交付物是结论与最小实验代码，不进入产品。

- 使用标准 Heart Rate Service，不接厂商云、不需要账号。
- 设备选择走 Electron 的 `select-bluetooth-device`。
- 记录六项：发现耗时、首个 BPM 时间、30 分钟稳定性、断开反馈、息屏后是否仍广播、1 小时耗电。

## Acceptance criteria

- [ ] 六项验收逐条给出结论（通过 / 不通过 / 无法验证）。
- [ ] 广播关闭后应用能报告断开，不静默卡住。
- [ ] 明确记录手环开启"心率广播"的实际步骤。
- [ ] 实验代码不进入 `src/`，数据不落库、不联网。
- [ ] 给出"是否值得产品化"的结论与理由。

## Out of scope

- 产品化集成、数据存储、热区融合。

## Verification

实验目录中的脚本与测量输出；结论写入完成记录。
