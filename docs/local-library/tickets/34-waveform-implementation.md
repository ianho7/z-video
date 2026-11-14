# 音频波形实现

ID: 34-waveform-implementation
Blocked by: 33, 26
Status: ready-for-agent

## What to build

用真实峰值替换进度条后面那条装饰性正弦线。用户可感知结果：进度条显示的是这部片子真实的音频起伏。

- 解码与峰值计算在 main/worker 边界内，renderer 只拿数值数组。
- 峰值按文件缓存，源文件变化才重算。
- 无数据或计算失败时回退为当前单一色条，不显示假波形。

## Acceptance criteria

- [ ] 进度条渲染真实峰值，与元数据（时长）对齐。
- [ ] 同一文件第二次打开命中缓存，不再解码。
- [ ] 计算失败时回退，不出现空波形或错位。
- [ ] 峰值数据体积在 spike 结论给出的预算内。
- [ ] 不阻塞打开播放，必要时先显示进度条再补波形。

## Out of scope

- 热区叠加（Ticket 32 已完成的话可组合，但不在本票验收）。
- 音频分析（响度、节拍）。

## Verification

`npm run typecheck` → `npm test` → 涉及播放器的窗口冒烟。
