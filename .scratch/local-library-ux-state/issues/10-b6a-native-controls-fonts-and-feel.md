# 10: B6a · 原生控件、字体与手感

**What to build:** 用户看到的不再是“Electron 套壳网页”：所有排序、音轨、字幕、倍速都用同一套应用内菜单，0 个原生 select；全站字体是应用同款 Nunito 优先并内嵌；正文不能被拖选，输入框仍可编辑；右键/拖拽/整块选中不出现；鼠标点击控件不出现矩形焦点框。

**Blocked by:** 03 (B2), 05 (B3b), 06 (B4a), 08 (B5a), 09 (B5b)

**Status:** ready-for-agent

- [ ] 排序、音轨、字幕、倍速全部使用应用内 listbox；0 个原生 `<select>`；控制条菜单向上弹出不越框。
- [ ] 菜单有 `role="listbox"/"option"`、`aria-haspopup/expanded`；方向键/Home/End/Enter/Space/Esc/Tab 与焦点回归正确。
- [ ] 播放设置面板空间不足时使用 inline chip 组，不出现被裁切的 popover。
- [ ] 全站字体为 Nunito 优先、中文系统回退；内嵌 Nunito woff2，正文/标题/数字同一字体栈。
- [ ] 正文 `user-select:none`，输入框/文本域 `text`；全局拦截 `contextmenu`/`dragstart`/非输入区 `selectstart`；右键粘贴菜单缺失作为已知取舍。
- [ ] 鼠标点击控件不出现矩形焦点框；只有键盘 `:focus-visible` 画环；搜索框焦点由外层胶囊表达。
- [ ] window smoke 覆盖 0 原生 select、菜单键盘、字体命中、选择/右键行为、焦点行为；900×640 不裁切。
