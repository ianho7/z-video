# 列表可见性与计数口径

ID: 11-library-list-visibility
Depends: 08
Priority: P1

## What to build

让"失效文件行（墓碑）"与"当前文件"在列表、作品卡和详情页上有一致且不重复的呈现。

- `list()` 只返回 `media_files.available = 1` 的行；墓碑不占位。
- `listCollections()` 的 `episodeCount` 改为可用文件口径（与 `availableEpisodeCount` 一致）；可用集数为 0 的作品不出现在作品列表。
- `getDetail()` 的 `episodes` 只列可用文件；整个作品无可用文件时返回明确的"不可用"结果而不是空列表伪成功。
- "来源离线"不受影响：离线是 `sources.available`，其文件行仍为 1，继续以置灰方式可见可解释。
- 如需查看/清理墓碑，README 与 contracts 记录当前不提供入口（本 Ticket 不新增筛选 UI）。

## Acceptance criteria

- [ ] 换片（指纹变化）后：文件列表只出现新文件一张卡；旧行不以可点/不可点卡片出现。
- [ ] 作品卡的 `episodeCount` 与 `availableEpisodeCount` 对同一作品口径一致，不再出现"2 集 / 1 可播"。
- [ ] 来源离线：文件行仍列出但不可播放，提示文案说明是文件夹离线而非文件缺失。
- [ ] 详情页不展示已失效文件行；全部失效的作品有可读的不可用状态。
- [ ] `docs/local-library/contracts.md` 明确写出 `available` 在列表/详情/计数三处的语义。

## Out of scope

- 墓碑 GC 与物理清理。
- 新增"失效文件"筛选入口。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
既有断言（如 partial 后 `items` 仍含条目）按新语义复核并在完成记录中说明。
