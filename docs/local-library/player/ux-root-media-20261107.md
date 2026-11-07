# 根目录媒体扫描修复证据 — 2026-11-07

## 范围

只覆盖 local-library worker 的根目录视频发现，以及现有 `LocalLibraryDatabase` utility owner smoke 的回归证明。未修改 renderer、preload、IPC 契约、symlink 边界逻辑或元数据兼容范围；未访问私人 NAS、未启动生产 GUI。

## 根因与修复

`discoverMedia()` 为根目录视频计算 collection relative path 时，原代码先调用 `makeRelative(rootPath, collectionDirectory)`。当 `collectionDirectory === rootPath` 时，`path.relative()` 返回空字符串，`makeRelative()` 按路径边界契约拒绝该值并抛错；后面的 `|| "."` 无法执行。扫描因此仍报告完成和已扫描文件，但该视频被条目级 catch 保留为 warning，未写入索引。

修复仅在 collection path 调用点将 `collectionDirectory === rootPath` 映射为 `"."`，继续使用全局 `makeRelative()` 校验媒体文件和 artwork 路径，未放宽越界检查。

## 回归 fixture

现有 database owner smoke 新增一个独立根目录 fixture：根目录直接放置一个 `.mkv` 和同名 `.nfo`。断言扫描结果为 `completed/scannedFiles=1/importedFiles=1/updatedFiles=0/warningCount=0`，并通过独立查询确认 NFO 标题和年份进入列表。之后移除该临时 source，避免影响原有断言；既有 symlink 逃逸 proof 保留。

## 验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:local-library` | PASS；包含本次根目录 fixture 和既有 utility owner/symlink smoke，日志位于 `.scratch/local-library/db-1794021908862-3676/electron.log` |
| `git diff --check` | PASS |

未运行 GUI、`test:local-library-app`、package 或 push；这些不属于本次 worker 调用点修复的最小证明范围。
