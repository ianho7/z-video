# 观看打点

ID: 22-watch-markers
Blocked by: 15
Status: ready-for-agent

## What to build

播放中一次按键记下"这里好"，成为该文件的时间点标记；关闭再打开时仍在，并显示在进度条上。用户可感知结果：自己攒下的"精华点"可见、可跳转。

- 播放器内快捷键记录当前位置（不打断播放）。
- 标记与 `mediaId` + 时间点绑定，跨进程保留。
- 进度条上显示标记刻度，可点击跳转。
- 标记可删除。

## Acceptance criteria

- [ ] 播放中按键即记录，不暂停、不弹窗打断。
- [ ] 重启应用后标记仍在，且只属于对应文件。
- [ ] 进度条可见标记，点击能跳到该时间点。
- [ ] 无标记时进度条不显示空刻度。
- [ ] 数据只存本机，不出现在任何 DTO 的路径字段里。

## Out of scope

- 自动生成标记（热区 / 波形）。
- 跨文件聚合视图。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → 涉及播放的窗口冒烟。
