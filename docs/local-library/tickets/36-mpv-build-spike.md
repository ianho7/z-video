# libmpv 定制构建 spike

ID: 36-mpv-build-spike
Blocked by: 外部输入（用户给出体积目标）
Status: ready-for-agent

## What to build

评估通过定制构建缩小安装体积的空间与维护成本。只有在给出明确体积目标后才启动。

- 估算裁剪 debug symbols、无用编码器、DVD/蓝光、非必需协议后的体积。
- 保留 D3D11（Windows）与未来 VideoToolbox（macOS）能力。
- 记录构建步骤、可复现性与升级成本。

## Acceptance criteria

- [ ] 给出当前体积构成（Electron / libmpv / 资源）与占比。
- [ ] 给出可裁剪项清单与预计收益，逐项标注风险。
- [ ] 给出与目标体积的差距对比。
- [ ] 结论明确：值得做 / 不值得做 / 只做部分裁剪。
- [ ] 不实际替换发布用二进制。

## Out of scope

- 实际发布包替换与签名。
- 更换播放内核。

## Verification

可行性报告；无需改动 `src/`。
