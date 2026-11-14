# 音频波形可行性 spike

ID: 33-waveform-spike
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

在动实现之前，用一次性实验回答三个问题：整轨解码要多久、峰值数组多大、首次打开是否可接受。交付物是结论，不是产品代码。

## Acceptance criteria

- [ ] 用真实 30–120 分钟文件测出解码耗时（如实记录机型与文件）。
- [ ] 给出降采样到 200–400 点后的缓存体积。
- [ ] 给出"首次打开即算"与"后台补算"两种方案的用户等待时间对比。
- [ ] 明确结论：实现 / 不实现 / 只对短文件实现。
- [ ] 实验代码不进入 `src/`。

## Out of scope

- 产品化实现（Ticket 34）。

## Verification

实验目录（`.scratch/` 或仓库外）中的脚本与测量输出；结论写入完成记录。
