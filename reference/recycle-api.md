# Zspace public web recycle APIs and callsite parameters

> NAS parity is **unchecked/incomplete**. Main supplied NAS version `2.3.2026082801` and saved NAS carriers with entry `index.3608137b.js`; an initial manifest/wrapper inspection began, but caller/parameter parity was not completed before the user requested an immediate stop. This report's conclusions and offsets remain tied to the cloud/public-web carriers listed below. Do not apply them to the NAS as confirmed behavior.

Static analysis of the supplied downloaded public scripts only. No network request, target-bundle execution, API invocation, package installation or REA session change was performed. The public web snapshot is not established to match installer **2.45.2026082601**.

The inventory contains **30 distinct method/path pairs: 14 recycle-core routes, 14 shared or conditional dependencies, and 2 wrappers without a demonstrated scoped caller**. Of these, 28 have a direct, conditional or alias reference in the selected feature/dependency callers; this does not establish runtime reachability. The GET thumbnail URL is a display-resource dependency, not a recycle mutation API.

Sources are preserved by main under [web-source-snapshot](web-source-snapshot/); [web-source-manifest.json](web-source-manifest.json) records source URLs, timestamps and SHA256. All 16 parsed source files matched both manifest and exact snapshot bytes during this analysis. The [machine catalog](recycle-api-catalog.json) contains 235 exact evidence slices, caller arguments, module IDs, source hashes and limitations.

## Evidence coordinates and coverage

All coordinates below are **0-based UTF-16 code-unit intervals `[start,end)`**, measured in the original minified file after UTF-8 decoding. They are neither UTF-8 byte offsets nor line numbers. A relative carrier `home/static/js/...` resolves under `work/zconnect-web/` or `outputs/web-source-snapshot/`. `evidence[].code` is the exact original slice; source files were not reformatted. Parser: bundled `@babel/parser` 8.0.4 at the user-specified npm-cache path.

Primary modules: `5219` file API object; `52324.extdevRecycle` Samba/source API; `89904` shared request wrapper; `24641` layout; `89813` personal; `33859` public/group; `33098` settings; `43549` search; `98345` restore destination selector; `74922.pC/r` thumbnail URL helper. The main all-wrapper index was reused to reconcile declarations; object export aliases and local/conditional calls were resolved from the AST and full enclosing methods.

## Route inventory

| ID | Class | Method and literal path | API module/member | Wrapper evidence | Scoped member references |
|---|---|---|---|---|---|
| R01 | core | `POST /v2/file/nb/list` | `5219.getRecycleFileList` | `E079` | `E080` |
| R02 | core | `POST /v2/file/list` | `5219.getFileList` | `E082` | `E083`, `E085`, `E087`, `E089`, `E091` |
| R03 | core | `POST /v2/file/remove` | `5219.remove` | `E093` | `E094`, `E096`, `E098` |
| R04 | core | `POST /v2/file/move` | `5219.move` | `E100` | `E101`, `E103`, `E105` |
| R05 | core | `POST /v2/file/restoreall` | `5219.restoreAll` | `E107` | `E108`, `E110`, `E112` |
| R06 | core | `POST /v2/file/mrestore` | `5219.mrestore` | `E114` | `E115`, `E116`, `E118` |
| R07 | core | `POST /v2/public/recycle/restore` | `5219.pubRestore` | `E120` | `E121`, `E122`, `E123` |
| R08 | core | `POST /v2/file/merge_restore` | `5219.restoreFile` | `E124` | `E125` |
| R09 | core | `POST /v2/file/empty_dir` | `5219.cleanDir` | `E126` | `E127`, `E129` |
| R10 | core | `POST /v2/file/rclean` | `5219.rdelall` | `E131` | `E132`, `E134`, `E136` |
| R11 | core | `POST /v2/public/recycle/clean` | `5219.cleanPubRecycle` | `E138` | `E139`, `E141`, `E143` |
| R12 | core | `POST /v2/file/recycle/config/get` | `5219.recycleConfigGet` | `E145` | `E146` |
| R13 | core | `POST /v2/file/recycle/config/save` | `5219.recycleConfigSave` | `E148` | `E149` |
| R14 | core | `POST /api/fileshare_service/samba/recycle` | `52324.extdevRecycle` | `E151` | `E152` |
| R15 | dependency | `POST /v2/file/taskbyids` | `5219.taskbyids` | `E154` | `E155`, `E157` |
| R16 | dependency | `POST /v2/file/taskdel` | `5219.taskdel` | `E159` | `E160`, `E162` |
| R17 | dependency | `POST /v2/file/task/continue` | `5219.taskContinue` | `E164` | `E165`, `E167` |
| R18 | dependency | `POST /file_search/search_log/get` | `5219.getSearchHistory` | `E169` | `E170`, `E173`, `E176`, `E179`, `E182`, `E185` |
| R19 | dependency | `POST /file_search/search_log/delete` | `5219.delSearchHistory` | `E188` | `E189`, `E191`, `E193` |
| R20 | dependency | `POST /file_search/slow_file_search/start` | `5219.slowFileSearchStart` | `E195` | `E196` |
| R21 | dependency | `POST /file_search/slow_file_search/get_result` | `5219.slowFileSearchStartGetResult` | `E198` | `E199` |
| R22 | dependency | `POST /file_search/slow_file_search/stop` | `5219.slowFileSearchStartStop` | `E201` | `E202` |
| R23 | dependency | `POST /file_search/file_search` | `5219.fileSearch` | `E204` | `E205`, `E207` |
| R24 | dependency | `POST /v2/public/group/list` | `5219.getGroupList` | `E209` | `E210` |
| R25 | dependency | `POST /v2/file/list/stream` | `5219.getFileListStream` | `E212` | `E213` |
| R26 | dependency | `POST /setting/load` | `74168.getShareSetting` | `E215` | `E216` |
| R27 | dependency | `POST /downloader/get/setting` | `14530.getSetting` | `E218` | `E219` |
| R28 | dependency | `GET /transcode/thumb` | `74922.getPreviewUrl` | `E221` | `E222`, `E224`, `E226`, `E228`, `E230` |
| R29 | wrapper only | `POST /v2/file/restore` | `5219.restore` | `E232` | none demonstrated |
| R30 | wrapper only | `GET /settings?root_list=true` | `5219.getRecycleExtDev` | `E233` | none demonstrated |

## Actual construction and consumed response fields

These are observations of caller construction and field access, not a complete backend schema. `currentPath`, selection arrays, store values and localStorage values are runtime inputs whose values were not acquired. No-argument calls are explicitly preserved; they are not rewritten as `{}`.

### Recycle core

**R01 — `POST /v2/file/nb/list` (`5219.getRecycleFileList`)**

Personal local-app list: path=currentPath,start=0,num=1000 initially. Used only when currentPath.split("/")[1]===".recycle". Wrapper passes data unchanged; no hidden-file or sort injection.

Consumed response: success/code,message,data.total,data.list,data.scan_info.state; scan_info preserved wholesale; list path,name,is_dir,size,original_path,ftype; frontend adds formatPath/pictureType/url/index.

Evidence: `E079` home/static/js/index.a785a6de.js `[324063,324150)` module `5219` / `getRecycleFileList / V`; caller methods `E009`.

**R02 — `POST /v2/file/list` (`5219.getFileList`)**

Personal non-virtual-root listing: {path:currentPath,start:pagination.start,num:pagination.num}; public/group: same plus sortby:"ctime",order:"desc",initial num=100; SMB/external root previews: {path:root.path,sortby:"ctime",order:"desc",start:0,size:20}. Wrapper overwrites show_hidden from <username>_showHiddenFile||0 and appends _linux to sortby under mac sort mode if it has no underscore. size and num are distinct observed caller keys.

Consumed response: success,code,message,data.total,data.list; row path,name,is_dir,size,change_time; public root storageNamesMap[path.split("/")[1]]; preview root total>20 enables More.

Evidence: `E082` home/static/js/index.a785a6de.js `[327731,328066)` module `5219` / `getFileList / tI`; caller methods `E009`, `E010`, `E028`, `E059`.

**R03 — `POST /v2/file/remove` (`5219.remove`)**

Selected permanent deletion: {paths:checkedList.map(row=>row.path)}; wrapper injects show_hidden=<username>_showHiddenFile||0. Same route used for personal/public/external/search selections; no permanent=true or recycle flag sent.

Consumed response: Common task envelope: success/code/message,data.otype,data.task.

Evidence: `E093` home/static/js/index.a785a6de.js `[329711,329886)` module `5219` / `remove / tZ`; caller methods `E011`, `E029`, `E053`.

**R04 — `POST /v2/file/move` (`5219.move`)**

Restore to another folder: paths=selected row paths; to=selector.selectedPaths[0]. No conflict/overwrite/merge flags. Wrapper tL may add file_hash_check_option from <username>_hashCheckOption only when <username>_hashCheck=="1", at least one source is outside a recognized pool and destination is in one.

Consumed response: Common task envelope. Selector returns folderPath,selectedPaths,selectedItems,checkedItemsMap; caller uses selectedPaths[0], ignores folderPath.

Evidence: `E100` home/static/js/index.a785a6de.js `[330278,330363)` module `5219` / `move / tj`; caller methods `E012`, `E030`, `E052`.

**R05 — `POST /v2/file/restoreall` (`5219.restoreAll`)**

{paths:[currentPath]}; personal external overview (atRecyeleRoot && pageIndex==2) sends all extDevRecycleList.map(root=>root.path), which have already been filtered to nonempty preview roots. No mode or conflict flags.

Consumed response: Common task envelope; N007007 special all-restore failure; task.fail_num,total_num,done_num.

Evidence: `E107` home/static/js/index.a785a6de.js `[323985,324063)` module `5219` / `restoreAll / W`; caller methods `E012`, `E030`.

**R06 — `POST /v2/file/mrestore` (`5219.mrestore`)**

Original-location restore for mode!="pub": {paths:checkedList.map(row=>row.path)}. External overview / module=="extdev" overrides this with restoreFile in personal component. Search recycle-myFile uses mrestore without that override.

Consumed response: success/code/message; data may be nonempty array of objects with path, or object with paths array. First path used for single-selection goDir dialog.

Evidence: `E114` home/static/js/index.a785a6de.js `[326784,326861)` module `5219` / `mrestore / tb`; caller methods `E012`, `E030`, `E052`.

**R07 — `POST /v2/public/recycle/restore` (`5219.pubRestore`)**

Original-location restore for mode=="pub", or search dirInfo.from=="recycle-public": {paths:selected row paths}. Public root toolbar/context menu hides original-location restore; nested entries expose it.

Consumed response: Same alternate data[]/data.paths response; public/search special N001454 failure; personal component also handles N007007.

Evidence: `E120` home/static/js/index.a785a6de.js `[326698,326784)` module `5219` / `pubRestore / tv`; caller methods `E012`, `E030`, `E052`.

**R08 — `POST /v2/file/merge_restore` (`5219.restoreFile`)**

Personal component original-location restore switches to this when atRecyeleRoot&&pageIndex==2 OR module=="extdev"; {paths:selected row paths}. There is no merge,overwrite,force parameter.

Consumed response: Same direct restore response; personal N007007/N001454 failure branches. Endpoint name alone does not prove merge/collision semantics.

Evidence: `E124` home/static/js/index.a785a6de.js `[324382,324463)` module `5219` / `restoreFile / K`; caller methods `E012`.

**R09 — `POST /v2/file/empty_dir` (`5219.cleanDir`)**

Empty external/SMB directory: personal component if module=="extdev" or external overview. Overview sends {paths:extDevRecycleList.map(root=>root.path)}, otherwise {paths:[currentPath]}. Selected deleteType=="any" takes remove first.

Consumed response: Common task envelope.

Evidence: `E126` home/static/js/index.a785a6de.js `[324463,324540)` module `5219` / `cleanDir / q`; caller methods `E011`.

**R10 — `POST /v2/file/rclean` (`5219.rdelall`)**

Empty personal recycle bin: called with zero arguments in mode=="file" after selected/external branches. Wrapper formal argument remains undefined; do not invent {path:currentPath} or paths. Search has same zero-argument branch.

Consumed response: Common task envelope. Exact server cleanup scope is not established by no-argument client call.

Evidence: `E131` home/static/js/index.a785a6de.js `[326304,326379)` module `5219` / `rdelall / tp`; caller methods `E011`, `E029`, `E053`.

**R11 — `POST /v2/public/recycle/clean` (`5219.cleanPubRecycle`)**

Empty public recycle: called with zero arguments for mode=="pub". No current group path passed even when invoked within a group. Search includes same branch.

Consumed response: Common task envelope. Group-local versus global public-bin cleanup cannot be resolved statically.

Evidence: `E138` home/static/js/index.a785a6de.js `[326379,326463)` module `5219` / `cleanPubRecycle / tg`; caller methods `E011`, `E029`, `E053`.

**R12 — `POST /v2/file/recycle/config/get` (`5219.recycleConfigGet`)**

Called with zero arguments on created and after successful save. Wrapper has no default body.

Consumed response: success; data.my_cycle and (isMaster) data.public_cycle. Positive value enables cleanup; displayed duration falls back to30 otherwise.

Evidence: `E145` home/static/js/index.a785a6de.js `[339833,339920)` module `5219` / `recycleConfigGet / eT`; caller methods `E040`.

**R13 — `POST /v2/file/recycle/config/save` (`5219.recycleConfigSave`)**

c={my_cycle:myCycle>0?my_cycle:-1}; if isMaster, c.public_cycle=publicCycle>0?public_cycle:-1. UI options days1,3,7,30,90; radio defaults -1, day defaults30. Radio watchers and select change callbacks both save.

Consumed response: success triggers config get; no save response data fields consumed. UI visibility and omission of public_cycle are not proof of server authorization.

Evidence: `E148` home/static/js/index.a785a6de.js `[339920,340008)` module `5219` / `recycleConfigSave / eE`; caller methods `E039`.

**R14 — `POST /api/fileshare_service/samba/recycle` (`52324.extdevRecycle`)**

{type:6,data:JSON.stringify({username:$store.state.user.username})}; inner data is a JSON string. Returned root type=="samba": name=storageNamesMap[root.path.split("/")[1]]+"-"+username; other types: localized external-device label+"-"+root.name. Every root.switch set1.

Consumed response: success/message,data.list root path,type,name. Each root is then queried with /v2/file/list (start0,size20); keep only roots with nonempty fileList. No setting/enable/disable type values proved by this caller.

Evidence: `E151` home/static/js/index.a785a6de.js `[377138,377247)` module `52324` / `extdevRecycle / object property`; caller methods `E010`.

### Shared and conditional dependencies

**R15 — `POST /v2/file/taskbyids` (`5219.taskbyids`)**

Poll every1000ms only if syncTasks nonempty: {ids:syncTasks.map(t=>t.id)}. Missing record treated locally as removed.

Consumed response: success,data.list[].id,state,done_num,total_num,fail_num,ext; states removed/done/fail finish, pause displays ext; progress=floor(100*done_num/total_num).

Evidence: `E154` home/static/js/index.a785a6de.js `[330600,330678)` module `5219` / `taskbyids / t$`; caller methods `E013`, `E031`.

**R16 — `POST /v2/file/taskdel` (`5219.taskdel`)**

After cancel confirmation: {id:currentTaskInfo.id}; closes dialog and pops local last task. Response is not inspected in recycle components.

Consumed response: No response fields consumed. Cancellation completion/atomicity unknown.

Evidence: `E159` home/static/js/index.a785a6de.js `[330678,330754)` module `5219` / `taskdel / tW`; caller methods `E016`, `E034`.

**R17 — `POST /v2/file/task/continue` (`5219.taskContinue`)**

{id:currentTaskInfo.id,ignore:t}; default t=0; pause UI Ignore uses1, Continue uses0.

Consumed response: Response not inspected. No overwrite mapping proved.

Evidence: `E164` home/static/js/index.a785a6de.js `[330754,330836)` module `5219` / `taskContinue / tV`; caller methods `E017`, `E035`.

**R18 — `POST /file_search/search_log/get` (`5219.getSearchHistory`)**

Personal/public/search: {search_type:1}; wrapper adds search_type=1 only if key missing.

Consumed response: success,data.list; history UI shown if nonempty.

Evidence: `E169` home/static/js/index.a785a6de.js `[323031,323177)` module `5219` / `getSearchHistory / R`; caller methods `E171`, `E174`, `E177`, `E180`, `E183`, `E186`.

**R19 — `POST /file_search/search_log/delete` (`5219.delSearchHistory`)**

{names:[selectedHistoryName]}; wrapper appends search_type:1 if absent, then caller refreshes history with search_type1 on success.

Consumed response: success/message; refreshed data.list.

Evidence: `E188` home/static/js/index.a785a6de.js `[322882,323031)` module `5219` / `delSearchHistory / B`; caller methods `E174`, `E180`, `E186`.

**R20 — `POST /file_search/slow_file_search/start` (`5219.slowFileSearchStart`)**

For recycle paths, noIndexSearch copies only {token:t.token,plat:t.plat,device:t.device,device_id:t.device_id,name:t.name,file_path:t.file_path,show_hidden:t.show_hidden}; ftype10=folder,100=any file, otherwise selected ftype; optional ftypes passed if present. Undefined fields remain object keys until transform; interceptor fills missing values. Wrapper resets show_hidden from local storage. order_by,min_size,max_size,shared_only are NOT copied.

Consumed response: success,data.taskid.

Evidence: `E195` home/static/js/index.a785a6de.js `[338739,338997)` module `5219` / `slowFileSearchStart / ew`; caller methods `E046`.

**R21 — `POST /file_search/slow_file_search/get_result` (`5219.slowFileSearchStartGetResult`)**

{taskid:this.taskid,start:search.start,num:search.num}; initial start0,num30. Wrapper also injects show_hidden. Poll every2500ms while response status==1; if existing fileList nonempty, increments start by num.

Consumed response: success/code/message,data.list,total,status,skip_dir; list path,name,is_dir,size,original_path,nshare,share_user_name,ext,match_string; status1 means keep polling.

Evidence: `E198` home/static/js/index.a785a6de.js `[338997,339260)` module `5219` / `slowFileSearchStartGetResult / eC`; caller methods `E046`.

**R22 — `POST /file_search/slow_file_search/stop` (`5219.slowFileSearchStartStop`)**

{taskid:this.taskid}; sets stop sign, clears search timer; on success resets loading/status.

Consumed response: success/message. Stop semantics/server lifetime unknown.

Evidence: `E201` home/static/js/index.a785a6de.js `[339260,339417)` module `5219` / `slowFileSearchStartStop / ex`; caller methods `E047`.

**R23 — `POST /file_search/file_search` (`5219.fileSearch`)**

Generic indexed-search branch constructs {name,order_by,ftype,is_dir,min_size,max_size,start,num,shared_only:(mode=="share"?1:2*!file_path),file_path}. Wrapper adds show_hidden. Recycle-path detection forces slow search, so full indexed filters are not a demonstrated recycle request. Destination selector search is a generic conditional branch; allowSearch defaults false here.

Consumed response: success,data.list,total,reindexing,index_time,skip_dir; these belong to generic branch, not established recycle server output.

Evidence: `E204` home/static/js/index.a785a6de.js `[325785,325969)` module `5219` / `fileSearch / tc`; caller methods `E045`, `E059`.

**R24 — `POST /v2/public/group/list` (`5219.getGroupList`)**

Restore destination selector /public: r=Object.assign({sortby:sort,order:sortType},pagination); r.path=currentPath; with_fields="encrypted,encrypt_icon" (or "" if SkipFileApiFilters=="1"); ftype10 when allowFile false. Initial pagination {total:0,start:0,num:100}.

Consumed response: success,data.total,data.list[].path,name,permission; hide permission2 if showPublic&&!showReadOnlyPublicGroup. timeout15000ms.

Evidence: `E209` home/static/js/index.a785a6de.js `[327205,327299)` module `5219` / `getGroupList / tw`; caller methods `E059`.

**R25 — `POST /v2/file/list/stream` (`5219.getFileListStream`)**

Restore destination selector for path components length>3, root!="share", and component2 in [public,my] or component1=="zspace"; same r shape as selector group/list. Wrapper adds show_hidden if absent, applies mac _linux sort, dup0. Calls local fetch-stream helper rather than common axios object.

Consumed response: Stream compact rows n,mt,ct,di,s,is,dw,ns,pt,ec,eci normalized to row name/path/modify_time/change_time/is_dir/size/is_sys/double_write/nshare/pin_time/encrypted/encrypt_icon/ftype; synthesized success/code200,data.list,existItemMap, no total in synthetic result. Selector falls back to list.length.

Evidence: `E212` home/static/js/index.a785a6de.js `[328066,328467)` module `5219` / `getFileListStream / tP`; caller methods `E059`.

**R26 — `POST /setting/load` (`74168.getShareSetting`)**

Destination selector fallback sort only when no local stored sort/order: zero arguments; response sortby=data.file.file_sort.sort_by, order=data.file.file_sort.order; fallbacks mtime/desc.

Consumed response: data.file.file_sort.sort_by/order; selector does not test success before dereference.

Evidence: `E215` home/static/js/index.a785a6de.js `[351259,351398)` module `74168` / `getShareSetting / l`; caller methods `E058`.

**R27 — `POST /downloader/get/setting` (`14530.getSetting`)**

Destination selector getDefaultDownloadDir calls named export $8 with zero arguments when opening initial non-recent path. Ancillary side effect of shared selector, not a recycle setting.

Consumed response: success,data.download_dir -> selector.savePath.

Evidence: `E218` home/static/js/async/86742.45029e7d.js `[11331,11413)` module `14530` / `getSetting / f`; caller methods `E063`.

**R28 — `GET /transcode/thumb` (`74922.getPreviewUrl`)**

URL builder74922.pC/r called for ftype101/102 with {file_path:row.path,s:row.size}; adds dest_fmt:"small",request_purpose:5 and optional window._PROXY_DEV_TYPE_ as device_type. 71617.wu encodes supplied key/value pairs only. Direct Image.src request, not axios; no token insertion shown in this builder.

Consumed response: Image onload/onerror updates loaded,error; personal verifyOri consumes width,height,ori. Image output/backend format unknown.

Evidence: `E221` home/static/js/index.a785a6de.js `[285444,285836)` module `74922` / `getPreviewUrl / r`; caller methods `E009`, `E010`, `E028`, `E045`, `E059`.

### Declared wrappers without scoped callers

**R29 — `POST /v2/file/restore` (`5219.restore`)**

Exported wrapper only: data:t, no in-scope caller demonstrated. Do not substitute for mrestore/merge_restore.

Consumed response: No caller-supported response fields.

Evidence: `E232` home/static/js/index.a785a6de.js `[326622,326698)` module `5219` / `restore / t_`.

**R30 — `GET /settings?root_list=true` (`5219.getRecycleExtDev`)**

Exported wrapper only; uses data:t even for GET, no in-scope caller demonstrated. This differs from actively used extdevRecycle type6.

Consumed response: No caller-supported response fields.

Evidence: `E233` home/static/js/index.a785a6de.js `[324540,324622)` module `5219` / `getRecycleExtDev / J`.

## Parameter, response and policy distinctions

### Personal, public/group, Samba and external sources

The layout links personal to `/.recycle/my` and public to `/.public_recycle`. Ordinary public-tab visibility depends on `isMaster==1`; `onlyTab=public` explicitly supplies a public-only sidebar. This client behavior does not demonstrate server authorization. `E003` home/static/js/async/92425.c709b1c5.js `[736,1497)` module `24641` / `created`.

Personal starts at `pageIndex=1` (local-app source), pagination `{start:0,num:1000}`, and uses `getRecycleFileList` only when the first path component is `.recycle`. That wrapper does **not** add `show_hidden` or sort fields. Public/group starts at `{start:0,num:100}`, uses generic file list with `sortby:"ctime",order:"desc"`, and displays deletion time from `change_time`. External/SMB previews use **`size:20`**, rather than `num`, with `sortby:"ctime",order:"desc"`. These key differences are literal, not normalized guesses. `E005`, `E009`, `E026`, `E028`, `E010`.

Source discovery always requests `type:6` and nests the current username inside JSON-string `data`. Samba roots are labeled with pool name and username; other types use external-device name. Root `switch=1` is a local expanded/collapsed display field, **not a proven backend recycle-enable switch**. Each root is previewed, then roots with an empty/failed preview are removed. The resulting filtered root array supplies bulk restore/empty paths. `total>20` enables More, which navigates to that root path. `E010` home/static/js/async/49535.02cfc4ad.js `[29747,31197)` module `89813` / `getExTDevList`.

Storage is carried by paths, `storageNamesMap` labels and shared store state. Pool recognition is `/^(sata|esata|nvme)\d+$/` or `/^zenith_\w+$/`. The personal route watcher sets `module="extdev"` when that pool predicate matches the first path component or the second component is `extdev`; this flag drives the merge-restore/empty-directory branches. No recycler-specific storage enumeration route or arbitrary-user filter API is shown. `E076`, `E018`, `E068`.

NAS shared-user files (`nshare`,`share_user_name`) and public/group recycle are separate client concepts. Search uses those response fields plus `ext`/`original_path` for source labels and generic shared-file action gating; it does not enumerate users or send a selected shared username for recycle. Generic `shared_only` is `1` for mode share, otherwise `2` for empty search path and `0` for nonempty path, and is dropped by the slow recycle-search construction. `E051`, `E045`, `E046`.

### Search filtering: constructed UI filters versus actual recycle requests

Recycle paths detected as `.recycle`/`.public_recycle`, per-pool `public_recycle`, or snapshot components `recycle`/`public_recycle` select the **slow search** flow: start task, get result, poll after 2500ms while `data.status==1`, optionally stop. Initial result page is `start:0,num:30`. Personal external-overview search is hidden at the root; navigating a source exposes path search. `E045`, `E046`, `E006`.

| UI input | Indexed-search construction | Slow recycle-search construction |
|---|---|---|
| Text/path | `name`, `file_path` | copied |
| Type | `is_dir`, `ftype` | folder becomes `ftype:10`; all files `100`; concrete type copied; no `is_dir` |
| Size | `min_size`,`max_size` | omitted |
| Order | `order_by` | omitted |
| Shared-only | `shared_only` | omitted |
| Paging | `start`,`num` | result request only |
| Hidden files | wrapper localStorage injection | start and result wrappers inject |

Type options: all, folder, file, video102, audio103, image101, document107, application105, archive106, torrent104. Size options construct exact byte thresholds `10485760`, `104857600`, `1073741824`; `0` represents the unbounded end in UI construction. Indexed order codes are relevance0, size-desc3/asc4, modified-desc5/asc6, name-asc7/desc8, type-asc9/desc10. These are UI/branch facts; size and order are not transmitted by the shown slow recycle path. `E044`, `E048`, `E049`, `E050`.

Slow results consume `data.list,total,status,skip_dir`; rows consume `path,name,is_dir,size,original_path,nshare,share_user_name,ext,match_string`. Search highlights U+0001/U+0002 marker spans, deduplicates by derived path ID, and removes markers from displayed name. `reindexing`/`index_time` apply to the indexed branch and are not established slow-result requirements. `E045` home/static/js/async/54379.c3a436f0.js `[14544,18375)` module `43549` / `search`.

### Restore, overwrite and merge

| Operation/context | Actual dispatch | Conflict controls sent |
|---|---|---|
| Personal original location | `mrestore({paths})` | none |
| Public/group original location | `pubRestore({paths})` | none |
| Personal SMB/external original location | `restoreFile` → `/v2/file/merge_restore`, `{paths}` | none |
| Search original location | only `pubRestore`/`mrestore` by `dirInfo.from` | no external override |
| Restore all | `restoreAll({paths:[currentPath]})`, or filtered external roots | none |
| Other location | `move({paths,to:selectedPaths[0]})` | optional hash-check setting only |

The frontend selects **which route** to call. It does not establish whether same-name files overwrite, get renamed, fail, or prompt server-side; whether directories merge recursively; whether originals are retained after partial failure; or whether an operation is atomic. No `overwrite`, `force`, `merge` or collision-policy argument is built here. `/merge_restore` suggests intent by name only. `taskContinue.ignore=1/0` means UI Ignore/Continue and cannot be equated to overwrite. `E012`, `E030`, `E052`, `E017`, `E075`.

Successful direct restores accept either `data[0].path` or `data.paths[0]`; the first path is used to open the parent folder after a single selection, while multi-selection shows success. Personal handles `N007007` (single/multi restore-failure variants) and `N001454`; public/search explicitly handle `N001454`. Restore-all also maps `N007007` to all-restore failure; task `fail_num,total_num,done_num` choose partial/all failure alerts. These are UI reactions, not a decoded backend error-code contract. `E012`, `E030`, `E052`, `E015`.

### Permanent delete and empty warnings

Both selected deletion and Empty open `DialogVisible="delete"`; selected sets `deleteType="any"`, Empty sets `"all"`. The confirmation button invokes `removeFile`, labeled `common_file_delete_immediately`, with Cancel available. General warning key is `common_prompt_permanently_delete_confirm`; personal nonroot external mode uses `chedishanc_911de2`. Exact localized prose was not found in these scripts and is not quoted. No second-stage recycle/recovery guarantee is established. `E064`, `E065`, `E012`, `E030`.

Selected deletion sends explicit paths. Normal personal/public Empty sends **no arguments**, including inside nested groups; exact backend cleanup scope remains unknown. External overview/directory Empty instead sends explicit root/directory paths to `/empty_dir`. A nested group screen therefore cannot justify claiming its no-argument public clean request only clears that group. `E011`, `E029`, `E053`.

### Settings and task behavior

Cleanup days are `1,3,7,30,90`; off is `-1`. UI day defaults are30, radio defaults off. Get response values `>0` enable cleanup and supply the days; other values leave a display fallback30/off. Save always carries `my_cycle`, adds `public_cycle` only if `isMaster`, and reloads config on success. Radio watchers and select change handlers call Save; actual timing and server scheduling were not observed. `E038`, `E040`, `E039`.

Delete/move/restore-all action responses use `success/code/message` plus `data.otype` and `data.task`. `otype=="async"` queues `task.id`; personal/public poll taskbyids every1000ms, derive percent from done/total, finish removed/done/fail or absent tasks, and display pause `ext`. Cancel confirms then sends taskdel; Ignore/Continue sends task/continue with1/0. Closing the background dialog itself sends no cancel request. Search has the same async-envelope consumer but no local polling/continuation definitions were found in43549 or selected mixin58301; this is a static evidence gap, not an observed runtime failure. `E014`, `E013`, `E016`, `E017`, `E054`.

## Shared dependencies and wire construction

Destination selector98345 supports mounted `storagePools`, public groups, valid/nonforbidden USB sources from store, local recent paths and conditional sort-settings lookup. The recycle caller enables directories, disables files, sets single selection, `extDevFilter:"*"`, and `showPublic:true`; `showShare` and `allowSearch` remain default false. Read-only public groups (`permission==2`) are filtered by default. Its normal list/group query is `{sortby,order,total,start,num,path,with_fields:"encrypted,encrypt_icon",ftype:10}`, with `SkipFileApiFilters=="1"` clearing `with_fields`. It selects generic list versus stream by path shape. The stream helper uses its own fetch/form construction and synthesizes normalized list fields, so common axios response guarantees must not be copied onto it. `E059`, `E060`, `E061`, `E235`.

Shared selector sort fallback calls POST `/setting/load`; its download-path initialization conditionally calls POST `/downloader/get/setting` even though this is not a recycle setting. Thumbnail builder uses GET `/transcode/thumb` with `file_path,s,dest_fmt=small,request_purpose=5`, plus optional proxy device_type; it only URL-encodes the supplied object, then callers load it via Image.src. Alternate encrypted/PTP URLs in the general builder are not selected by these `{file_path,s}` recycle calls and are not added as recycle routes.

Common request module89904 uses a30000ms default. For applicable **object-data** POSTs, missing fields are appended: `plat:web,version,device_id,device,_l`, and on the normal form path `token,nasid`. ClusterHost may prefix the route and enable credentials. It adds `?&rnd=<timestamp_random>&webagent=v2` (or `&rnd=...` on an existing query). Arrays encode as `paths[]=...`/`ids[]=...`; scalar fields are URL-encoded. No-argument wrappers preserve `data:undefined` and the helper checks that data is an object, so this report does not fabricate a JSON body or claim the exact final auth transport for them. Response200/`S000200` becomes success; errors normalize `code,message,reason,success:false,data?`. List booleans/numeric fields and extension-derived ftype are frontend normalization, not necessarily raw server fields. `E072`, `E073`, `E074`.

Shared chunks86742/572/66758 were inspected:86742 provides empty/display component31096 and shared downloader API14530;572 provides icon/type helpers68764 and assets;66758 contains qs/side-channel support. They do not supply a hidden recycle-policy API. Sidebar42909, virtual-scroll32656, sort33193, and search mixin85759 are traced display/support carriers. Search co-loads archive dialogs48605/76670; unrelated archive/media/download operations are excluded. Snapshot reuse delegates `handleFileActions({checkedList,action:"download"|"copy",cb})`; its global event implementations were not attributed to recycle HTTP routes.

## Key issues and boundaries

| ID | Finding | Evidence type | Evidence |
|---|---|---|---|
| F01 | Empty is not constructed as current-directory deletion for normal personal/public bins. Selected rows use remove({paths}). Empty personal/public call rdelall()/cleanPubRecycle() with no arguments, including when currentPath is nested. Only the external/SMB cleanDir branch carries explicit root/directory paths. The UI warning applies to the delete dialog; do not promise a group-scoped or recoverable cleanup. | static observation; server scope unknown | `E011`, `E029`, `E064`, `E065` |
| F02 | Search original restore does not reproduce the personal SMB/external merge_restore dispatch. Personal openDialog switches to restoreFile for external overview or module=extdev. Search recycleOpenDialog chooses only pubRestore/mrestore based on dirInfo.from. No external override or merge/overwrite flag is carried through search. | static branch difference; runtime consequence unknown | `E012`, `E052`, `E018` |
| F03 | Slow recycle search drops size/order/shared_only filters. search builds order_by,min_size,max_size,shared_only, but recycle path detection selects noIndexSearch, which omits those fields. Type filtering survives as ftype10/100 or concrete selected ftype. No recycle request carries a storage selector or arbitrary shared-user filter. Username is explicit only inside the type6 source-discovery JSON. | static parameter omission; server interpretation unknown | `E045`, `E046`, `E048`, `E049`, `E010` |
| F04 | Same-name overwrite and directory merge policy are not implemented by these callsites. Original restore sends paths only; alternate-location restore sends paths and to (plus conditional hash-check option), restore-all sends paths only. There is no conflict preflight, overwrite/merge/force argument, or local collision decision in these methods. merge_restore is an endpoint name, not proof of how conflicting files or folders are handled. task continue ignore1/0 is a resume decision, not a proven overwrite option. | server unknown | `E012`, `E030`, `E052`, `E017`, `E075` |
| F05 | External overview filters the roots that bulk operations act upon. type6 roots each receive a start0,size20 preview. Roots with empty fileList, including failed preview requests, are removed from extDevRecycleList. Empty/restore-all use this filtered root array. More appears only when reported total>20. This is not evidence that the overview contains every server recycle source. | static observation; completeness depends on server results | `E010`, `E011`, `E012` |
| F06 | Search async-task completion has a local evidence gap. Search handleSyncApi adds async results to syncTasks, but no loopTasks/cancelTask/continueTask definitions or taskbyids call are found in 43549 or its selected 58301 mixin. Personal/public components do define their polling loop. Global handlers or server synchronous responses may affect behavior; no runtime failure is asserted. | bounded negative static finding | `E054`, `E013`, `E031` |

No request was sent to determine API availability, authorization, retention enforcement, deletion recoverability, conflict policy, server defaults or complete response schemas. Frontend admin visibility, a route name, and a UI success label do not establish those properties. The two wrapper-only rows R29/R30 remain declarations, not caller-backed behavior. `getNbFileList/tT` shares the R01 path but injects hidden-file/mac-sort settings unlike `getRecycleFileList/V`; its alternate wrapper is `E234` home/static/js/index.a785a6de.js `[328467,328805)` module `5219` / `getNbFileList / tT`.

## Exact evidence locations and short code

The table provides short excerpts; the JSON holds each complete exact slice and all route-to-caller links. A shortened excerpt is not the full interval.

| Evidence | Relative file | UTF-16 interval | Module / method | Short code |
|---|---|---|---|---|
| E001 | home/static/js/index.a785a6de.js | `[319136,321362)` | 5219 / 5219.ZP API object | <code>{getFileList:tI,getFileListStream:tP,getNbFileList:tT,getRemoteFileList:tM,getRecycleFileList:V,setPublicSwitch:tk,getPublicSwitch …</code> |
| E002 | home/static/js/async/92425.c709b1c5.js | `[246,427)` | 24641 / data | <code>data:function(){return{links:[{link:"/recycle/myFile?path="+encodeURIComponent("/.recycle/my"),mode:"/recycle/myFile",label:(0,n.$ …</code> |
| E003 | home/static/js/async/92425.c709b1c5.js | `[736,1497)` | 24641 / created | <code>created:function(){"public"==this.$route.query.onlyTab?this.links=[{link:"/recycle/public?path="+encodeURIComponent("/.public_recy …</code> |
| E004 | home/static/js/async/92425.c709b1c5.js | `[437,734)` | 24641 / checkActive | <code>checkActive:function(e){var t=this.$route;if("fileSearch"==t.name){var i=t.query.dirInfo?JSON.parse(t.query.dirInfo):{};if(i.from&amp; …</code> |
| E005 | home/static/js/async/49535.02cfc4ad.js | `[2809,4157)` | 89813 / data | <code>data:function(){return{dataLoading:!1,searchHistoryList:[],showSearchHistory:!1,isInit:!1,restoreFilePath:"",view:2,shareTime:null …</code> |
| E006 | home/static/js/async/49535.02cfc4ad.js | `[5948,6144)` | 89813 / showSearch | <code>showSearch:function(){return!!this.currentPath&amp;&amp;(!/^\/\.recycle\/my$/gi.test(this.currentPath)\|\|2!=this.pageIndex)&amp;&amp;(!this.isBrows …</code> |
| E007 | home/static/js/async/49535.02cfc4ad.js | `[6287,6543)` | 89813 / search | <code>search:function(){var t=(0,a._)((0,o._)({dirInfo:JSON.stringify({name:(0,r.$t)("common_app_recycle_bin"),path:this.currentPath,fro …</code> |
| E008 | home/static/js/async/49535.02cfc4ad.js | `[7244,7629)` | 89813 / changeRootPageShow | <code>changeRootPageShow:function(t){var e=this;this.pageIndex!=t&amp;&amp;(this.pageIndex=t,this.checkedList=[]),2==t&amp;&amp;(this.dataLoading=!0,thi …</code> |
| E009 | home/static/js/async/49535.02cfc4ad.js | `[13440,15936)` | 89813 / getFileList | <code>getFileList:function(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]&amp;&amp;arguments[0];return(0,s._)(function(){var e,i,o,a;return(0 …</code> |
| E010 | home/static/js/async/49535.02cfc4ad.js | `[29747,31197)` | 89813 / getExTDevList | <code>getExTDevList:function(t){var e=this;t&amp;&amp;this.$root.$emit("loading",(0,r.$t)("common_prompt_loading")),p.ZP.extdevRecycle({type:6,d …</code> |
| E011 | home/static/js/async/49535.02cfc4ad.js | `[16602,17585)` | 89813 / removeFile | <code>removeFile:function(){return(0,s._)(function(){var t,e,i;return(0,n.Jh)(this,function(s){return this.DialogVisible=null,t=[],this. …</code> |
| E012 | home/static/js/async/49535.02cfc4ad.js | `[21337,24065)` | 89813 / openDialog | <code>openDialog:function(t){var e=this;if(this.showDialogVisible=!0,"delete"==t)this.DialogVisible="delete",this.deleteType="any";else  …</code> |
| E013 | home/static/js/async/49535.02cfc4ad.js | `[17586,18370)` | 89813 / loopTasks | <code>loopTasks:function(){return(0,s._)(function(){var t,e,i,s,o;return(0,n.Jh)(this,function(a){switch(a.label){case 0:if(!this.syncTa …</code> |
| E014 | home/static/js/async/49535.02cfc4ad.js | `[19656,20538)` | 89813 / handleSyncApi | <code>handleSyncApi:function(t,e){var i=this;this.$root.$emit("loading",e.action),this.$rootDispatch("subwindows/setLoading",{name:windo …</code> |
| E015 | home/static/js/async/49535.02cfc4ad.js | `[18371,19655)` | 89813 / handleFinishedTask | <code>handleFinishedTask:function(t,e){var i=this;if(t&amp;&amp;e){var s=parseInt(e.fail_num)&gt;0;if("restoreAll"==t.mode){s?parseInt(e.total_num) …</code> |
| E016 | home/static/js/async/49535.02cfc4ad.js | `[20539,20817)` | 89813 / cancelTask | <code>cancelTask:function(){var t=this;this.$root.$myConfirm.show((0,r.$t)("common_prompt_cancel_task_confirm_recommand_background"),(0, …</code> |
| E017 | home/static/js/async/49535.02cfc4ad.js | `[20818,20962)` | 89813 / continueTask | <code>continueTask:function(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]?arguments[0]:0;d.ZP.taskContinue({id:this.currentTaskInfo. …</code> |
| E018 | home/static/js/async/49535.02cfc4ad.js | `[31592,32210)` | 89813 / $route | <code>$route:function(t){this.$route.query.path&amp;&amp;(this.pagination.start=0,this.showBackToTop=!1,this.currentPath=this.$route.query.path, …</code> |
| E019 | home/static/js/async/49535.02cfc4ad.js | `[32211,32302)` | 89813 / pageIndex | <code>pageIndex:function(t){this.showBackToTop=!1,this.changeRootPageShow(t),this.checkedList=[]}</code> |
| E020 | home/static/js/async/49535.02cfc4ad.js | `[2200,2400)` | 89813 / mounted | <code>mounted:function(){var t=this;if("number"!=typeof this.value)return void this.$emit("input",this.list[0].val);this.list.find(funct …</code> |
| E021 | home/static/js/async/49535.02cfc4ad.js | `[31340,31465)` | 89813 / onDownload | <code>onDownload:function(){this.$root.$emit("handleFileActions",{checkedList:this.checkedList,action:"download",cb:function(){}})}</code> |
| E022 | home/static/js/async/49535.02cfc4ad.js | `[31466,31583)` | 89813 / onCopy | <code>onCopy:function(){this.$root.$emit("handleFileActions",{checkedList:this.checkedList,action:"copy",cb:function(){}})}</code> |
| E023 | home/static/js/async/49535.02cfc4ad.js | `[9393,10396)` | 89813 / showRightMenu | <code>showRightMenu:function(t,e){var i=[];this.isBrowseSnap?i.push({icon:"copyIcon",disabled:0==this.checkedList.length,callback:this.o …</code> |
| E024 | home/static/js/async/49535.02cfc4ad.js | `[12567,13439)` | 89813 / openDir | <code>openDir:function(t){return(0,s._)(function(){return(0,n.Jh)(this,function(e){if("0"==t.is_dir)return this.showMessage((0,r.$t)("co …</code> |
| E025 | home/static/js/async/49535.02cfc4ad.js | `[16116,16502)` | 89813 / tryLoadThumb | <code>tryLoadThumb:function(){var t=this;if(!(this.imageLoadProcess&gt;4)&amp;&amp;0!=this.thumbList.length){var e=this.thumbList.shift();this.imag …</code> |
| E026 | home/static/js/async/79367.22d2ea19.js | `[2117,3293)` | 33859 / data | <code>data:function(){return{searchHistoryList:[],showSearchHistory:!1,restoreFilePath:"",view:2,shareTime:null,freshing:!1,moduleFrom:" …</code> |
| E027 | home/static/js/async/79367.22d2ea19.js | `[4850,5121)` | 33859 / search | <code>search:function(){var t=(0,n._)((0,o._)({dirInfo:JSON.stringify({name:(0,r.$t)("common_app_recycle_bin"),path:this.currentPath,fro …</code> |
| E028 | home/static/js/async/79367.22d2ea19.js | `[10652,12056)` | 33859 / getFileList | <code>getFileList:function(){return(0,s._)(function(){var t,e;return(0,a.Jh)(this,function(i){switch(i.label){case 0:if(t=this,this.load …</code> |
| E029 | home/static/js/async/79367.22d2ea19.js | `[12722,13484)` | 33859 / removeFile | <code>removeFile:function(){return(0,s._)(function(){var t,e,i;return(0,a.Jh)(this,function(s){return this.DialogVisible=null,t=[],this. …</code> |
| E030 | home/static/js/async/79367.22d2ea19.js | `[17026,19144)` | 33859 / openDialog | <code>openDialog:function(t){var e=this;if(this.showDialogVisible=!0,"delete"==t)this.DialogVisible="delete",this.deleteType="any";else  …</code> |
| E031 | home/static/js/async/79367.22d2ea19.js | `[13485,14269)` | 33859 / loopTasks | <code>loopTasks:function(){return(0,s._)(function(){var t,e,i,s,o;return(0,a.Jh)(this,function(n){switch(n.label){case 0:if(!this.syncTa …</code> |
| E032 | home/static/js/async/79367.22d2ea19.js | `[15426,16227)` | 33859 / handleSyncApi | <code>handleSyncApi:function(t,e){var i=this;this.$root.$emit("loading",e.action),this.$rootDispatch("subwindows/setLoading",{name:windo …</code> |
| E033 | home/static/js/async/79367.22d2ea19.js | `[14270,15425)` | 33859 / handleFinishedTask | <code>handleFinishedTask:function(t,e){var i=this;if(t&amp;&amp;e){var s=parseInt(e.fail_num)&gt;0;if("restoreAll"==t.mode){s?parseInt(e.total_num) …</code> |
| E034 | home/static/js/async/79367.22d2ea19.js | `[16228,16506)` | 33859 / cancelTask | <code>cancelTask:function(){var t=this;this.$root.$myConfirm.show((0,r.$t)("common_prompt_cancel_task_confirm_recommand_background"),(0, …</code> |
| E035 | home/static/js/async/79367.22d2ea19.js | `[16507,16651)` | 33859 / continueTask | <code>continueTask:function(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]?arguments[0]:0;A.ZP.taskContinue({id:this.currentTaskInfo. …</code> |
| E036 | home/static/js/async/79367.22d2ea19.js | `[25870,26964)` | 33859 / mounted | <code>mounted:function(){return(0,s._)(function(){return(0,a.Jh)(this,function(t){switch(t.label){case 0:return"recyclePublic"==this.$ro …</code> |
| E037 | home/static/js/async/79367.22d2ea19.js | `[7541,8626)` | 33859 / showRightMenu | <code>showRightMenu:function(t,e){var i=[];this.isBrowseSnap?i.push({icon:"copyIcon",disabled:0==this.checkedList.length,callback:this.o …</code> |
| E038 | home/static/js/async/51444.3a58c198.js | `[208,761)` | 33098 / data | <code>data:function(){return{my_cycle_opts:[{label:(0,a.$t)("common_recycle_bin_auto_delete_files_older_than_n_days",{num:1}),value:1},{ …</code> |
| E039 | home/static/js/async/51444.3a58c198.js | `[1031,1300)` | 33098 / recycleConfigSave | <code>recycleConfigSave:function(){var e=this,c={my_cycle:this.myCycle&gt;0?this.my_cycle:-1};this.isMaster&amp;&amp;(c.public_cycle=this.publicCyc …</code> |
| E040 | home/static/js/async/51444.3a58c198.js | `[1301,1592)` | 33098 / recycleConfigGet | <code>recycleConfigGet:function(){var e=this;n.ZP.recycleConfigGet().then(function(c){c.success&amp;&amp;(e.my_cycle=c.data.my_cycle&gt;0?c.data.my …</code> |
| E041 | home/static/js/async/51444.3a58c198.js | `[1594,1637)` | 33098 / created | <code>created:function(){this.recycleConfigGet()}</code> |
| E042 | home/static/js/async/51444.3a58c198.js | `[813,864)` | 33098 / publicCycle | <code>publicCycle:function(e,c){this.recycleConfigSave()}</code> |
| E043 | home/static/js/async/51444.3a58c198.js | `[865,912)` | 33098 / myCycle | <code>myCycle:function(e,c){this.recycleConfigSave()}</code> |
| E044 | home/static/js/async/54379.c3a436f0.js | `[408,3305)` | 43549 / data | <code>data:function(){var e=document.querySelector(".sidebar"),t=e?e.offsetWidth:200;return{reindexing:2,flashExpire:window.localStorage …</code> |
| E045 | home/static/js/async/54379.c3a436f0.js | `[14544,18375)` | 43549 / search | <code>search:function(e){return(0,s._)(function(){var t,i,s,o,n,a;return(0,c.Jh)(this,function(r){switch(r.label){case 0:if(t=this,this. …</code> |
| E046 | home/static/js/async/54379.c3a436f0.js | `[13426,14543)` | 43549 / noIndexSearch | <code>noIndexSearch:function(){var e=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]&amp;&amp;arguments[0],t=arguments.length&gt;1?arguments[1]:void 0;re …</code> |
| E047 | home/static/js/async/54379.c3a436f0.js | `[13103,13425)` | 43549 / noIndexSearchStop | <code>noIndexSearchStop:function(){var e=this;this.noIndexSearchStop_sign=!0,clearTimeout(this.noIndexSearch_timer),h.ZP.slowFileSearchS …</code> |
| E048 | home/static/js/async/54379.c3a436f0.js | `[12329,12722)` | 43549 / fileType | <code>fileType:function(e){if(this.ftypeText=this.ftypeSourceMap[e],"dir"==e){if(1===this.is_dir)return;this.is_dir=1,this.ftype=""}else …</code> |
| E049 | home/static/js/async/54379.c3a436f0.js | `[12723,13102)` | 43549 / fileSize | <code>fileSize:function(e){this.sizeText!=this.sizeSourceMap[e]&amp;&amp;(this.sizeText=this.sizeSourceMap[e],0==e?(this.max_size=0xa00000,this. …</code> |
| E050 | home/static/js/async/54379.c3a436f0.js | `[12197,12328)` | 43549 / fileSort | <code>fileSort:function(e){this.order_byText=this.orderbySourceMap[e],this.order_by!=e&amp;&amp;(this.order_by=e,this.iniData(),this.search(!1)) …</code> |
| E051 | home/static/js/async/54379.c3a436f0.js | `[5280,5963)` | 43549 / checkedList | <code>checkedList:function(){var e=this;this.checkedSys=!1,this.operateList=[],this.checkedMap={};var t=!0,i=!0,s=!0;0==this.checkedList …</code> |
| E052 | home/static/js/async/54379.c3a436f0.js | `[31193,33107)` | 43549 / recycleOpenDialog | <code>recycleOpenDialog:function(e){var t=this;console.log(this.dirInfo),this.showDialogVisible=!0;var i=this.dirInfo,o="recycle-public" …</code> |
| E053 | home/static/js/async/54379.c3a436f0.js | `[35915,36717)` | 43549 / removeFile | <code>removeFile:function(){return(0,s._)(function(){var e,t,i,s,o,n;return(0,c.Jh)(this,function(a){return t="recycle-public"==(e=this. …</code> |
| E054 | home/static/js/async/54379.c3a436f0.js | `[36718,37566)` | 43549 / handleSyncApi | <code>handleSyncApi:function(e,t){var i=this;this.$root.$emit("loading",t.action),this.$rootDispatch("subwindows/setLoading",{name:windo …</code> |
| E055 | home/static/js/async/54379.c3a436f0.js | `[37567,38566)` | 43549 / handleFinishedTask | <code>handleFinishedTask:function(e,t){if(e&amp;&amp;t){var i=parseInt(t.fail_num)&gt;0;if("restoreAll"==e.mode){i?parseInt(t.total_num)&gt;parseInt(t …</code> |
| E056 | home/static/js/async/54379.c3a436f0.js | `[27628,31192)` | 43549 / showRightMenu | <code>showRightMenu:function(e,t){var i=this.dirInfo;if(0!=this.checkedList.length){if(this.isBrowseSnap){var s=[];return 1!=this.checke …</code> |
| E057 | home/static/js/async/54379.c3a436f0.js | `[52998,54562)` | 43549 / mounted | <code>mounted:function(){if(console.log("search mounted"),this.fullPathCache=this.$route.fullPath,this.dirInfo=JSON.parse(this.$route.qu …</code> |
| E058 | home/static/js/async/47684.94a3f361.js | `[4636,5253)` | 98345 / initDefaultSort | <code>initDefaultSort:function(){return(0,s._)(function(){var t,e,i,s;return(0,l.Jh)(this,function(a){switch(a.label){case 0:if(t=this.c …</code> |
| E059 | home/static/js/async/47684.94a3f361.js | `[11985,19018)` | 98345 / showDirAfter | <code>showDirAfter:function(t){return(0,s._)(function(t){var e,i,s,a,r,h,u,p,m,v,_,b,g,w,k,P,S,x=arguments;return(0,l.Jh)(this,function( …</code> |
| E060 | home/static/js/async/47684.94a3f361.js | `[21896,23618)` | 98345 / mounted | <code>mounted:function(){var t=this;this.checkedList={},this.checkedItems=[],this.filelist=[],this.realPath=[],this.savePath=this.RootPa …</code> |
| E061 | home/static/js/async/47684.94a3f361.js | `[20072,20447)` | 98345 / appendExtDevs | <code>appendExtDevs:function(){var t=this,e=this.$rootEmit("fetchStore","nas.usbList");this.extNamesMap=this.$rootEmit("fetchStore","nas …</code> |
| E062 | home/static/js/async/47684.94a3f361.js | `[6766,9781)` | 98345 / doSubmit | <code>doSubmit:function(){var t,e=this,i=[],s=[],l={};"/recently"==this.currentDev?this.recentlyDirs.forEach(function(t){t.checked&amp;&amp;(i.p …</code> |
| E063 | home/static/js/async/47684.94a3f361.js | `[19945,20071)` | 98345 / getDefaultDownloadDir | <code>getDefaultDownloadDir:function(){var t=this;(0,h.$8)().then(function(e){e.success&amp;&amp;e.data&amp;&amp;(t.savePath=e.data.download_dir)})}</code> |
| E064 | home/static/js/async/49535.02cfc4ad.js | `[53108,53973)` | 89813 / render | <code>"delete"==t.DialogVisible?e("el-dialog",{attrs:{title:t.$t("common_prompt_notice"),visible:t.showDialogVisible,width:"460px","show …</code> |
| E065 | home/static/js/async/79367.22d2ea19.js | `[37381,38146)` | 33859 / render | <code>"delete"==t.DialogVisible?e("el-dialog",{attrs:{title:t.$t("common_prompt_notice"),visible:t.showDialogVisible,width:"460px","show …</code> |
| E066 | home/static/js/async/49535.02cfc4ad.js | `[36744,38772)` | 89813 / render | <code>t.atRecyeleRoot?e("div",{staticClass:"tabGroup"},[e("common-tabs",{attrs:{list:[{label:t.$t("common_recycle_bin_by_local_app"),val …</code> |
| E067 | home/static/js/async/79367.22d2ea19.js | `[30748,31602)` | 33859 / render | <code>t.atRootOfPublic?t._e():e("el-dropdown-item",{attrs:{command:"restore"}},[t._v(t._s(t.$t("common_button_restore_original_path")))] …</code> |
| E068 | home/static/js/async/79367.22d2ea19.js | `[36901,37099)` | 33859 / render | <code>nction(i){return[e("div",{staticStyle:{"white-space":"nowrap","text-overflow":"ellipsis",overflow:"hidden"}},[t._v(t._s(t.storageN …</code> |
| E069 | home/static/js/async/49535.02cfc4ad.js | `[56187,56844)` | 89813 / render | <code>e"==t.currentTaskInfo.state?[e("el-button",{staticClass:"fl",attrs:{type:"text"},on:{click:function(e){return t.continueTask(1)}}} …</code> |
| E070 | home/static/js/async/47684.94a3f361.js | `[546,2283)` | 98345 / FileSelector props | <code>t:""},type:{type:String,default:"album"},title:{type:String,default:""},ptAction:{type:String,default:""},canCancel:{type:Boolean, …</code> |
| E071 | home/static/js/index.a785a6de.js | `[1390291,1392337)` | 89904 / 89904 request transforms/interceptor | <code>n(t){var e="";if("server"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="https://znas.cn":"direct"==t.apiTar …</code> |
| E072 | home/static/js/index.a785a6de.js | `[1389746,1389951)` | 89904 / v | <code>v=[function(t){var e=function(e){var a=t[e];Array.isArray(a)?a.forEach(function(t){s.push(e+"[]="+encodeURIComponent(t))}):s.push( …</code> |
| E073 | home/static/js/index.a785a6de.js | `[1390257,1391787)` | 89904 / _.interceptors.request.use | <code>_.interceptors.request.use(function(t){var e="";if("server"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="h …</code> |
| E074 | home/static/js/index.a785a6de.js | `[1392099,1396448)` | 89904 / _.interceptors.response.use | <code>_.interceptors.response.use(function(t){var e=f.find(function(t){return"img"===t.type})\|\|{};e.ftype&amp;&amp;(e.name=(0,g.eh)(),e.name.spl …</code> |
| E075 | home/static/js/index.a785a6de.js | `[329886,330278)` | 5219 / tL | <code>function tL(t){var e="1"==localStorage.getItem("".concat(f.Z.state.user.username,"_hashCheck")),s=localStorage.getItem("".concat(f …</code> |
| E076 | home/static/js/index.a785a6de.js | `[1356101,1356179)` | 71617 / 71617.tU | <code>function tU(t){return/^(sata\|esata\|nvme)\d+$/.test(t)\|\|/^zenith_\w+$/.test(t)}</code> |
| E077 | home/static/js/index.a785a6de.js | `[1356179,1356311)` | 71617 / 71617.tH | <code>function tH(t){if(!t\|\|"string"!=typeof t)return!1;var e=t.replace(/^\/+/,"").split("/").filter(Boolean);return e.length&gt;0&amp;&amp;tU(e[0] …</code> |
| E078 | home/static/js/index.a785a6de.js | `[1351011,1351128)` | 71617 / 71617.tC | <code>function tC(t){return t?tS(Object.keys(t).map(function(e){return void 0===t[e]?"":tw(e)+"="+tw(t[e])})).join("&amp;"):""}</code> |
| E079 | home/static/js/index.a785a6de.js | `[324063,324150)` | 5219 / getRecycleFileList / V | <code>function V(t){return(0,n.Z)({url:"/v2/file/nb/list",method:"post",data:t,timeout:6e5})}</code> |
| E080 | home/static/js/async/49535.02cfc4ad.js | `[14058,14081)` | 89813 / getFileList | <code>d.ZP.getRecycleFileList</code> |
| E081 | home/static/js/async/49535.02cfc4ad.js | `[14058,14158)` | 89813 / getFileList | <code>d.ZP.getRecycleFileList({path:this.currentPath,start:this.pagination.start,num:this.pagination.num})</code> |
| E082 | home/static/js/index.a785a6de.js | `[327731,328066)` | 5219 / getFileList / tI | <code>function tI(t){return t.show_hidden=window.localStorage.getItem("".concat(f.Z.state.user.username,"_showHiddenFile"))\|\|0,"mac"==wi …</code> |
| E083 | home/static/js/async/49535.02cfc4ad.js | `[14207,14223)` | 89813 / getFileList | <code>d.ZP.getFileList</code> |
| E084 | home/static/js/async/49535.02cfc4ad.js | `[14207,14300)` | 89813 / getFileList | <code>d.ZP.getFileList({path:this.currentPath,start:this.pagination.start,num:this.pagination.num})</code> |
| E085 | home/static/js/async/49535.02cfc4ad.js | `[30357,30373)` | 89813 / getExTDevList | <code>d.ZP.getFileList</code> |
| E086 | home/static/js/async/49535.02cfc4ad.js | `[30357,30376)` | 89813 / getExTDevList | <code>d.ZP.getFileList(e)</code> |
| E087 | home/static/js/async/79367.22d2ea19.js | `[10903,10919)` | 33859 / getFileList | <code>A.ZP.getFileList</code> |
| E088 | home/static/js/async/79367.22d2ea19.js | `[10903,11024)` | 33859 / getFileList | <code>A.ZP.getFileList({path:this.currentPath,start:this.pagination.start,num:this.pagination.num,sortby:"ctime",order:"desc"})</code> |
| E089 | home/static/js/async/47684.94a3f361.js | `[13970,13986)` | 98345 / showDirAfter | <code>c.ZP.getFileList</code> |
| E090 | home/static/js/async/47684.94a3f361.js | `[13970,14039)` | 98345 / showDirAfter | <code>c.ZP.getFileList({num:200,sortby:"ctime",order:"desc",path:"/share"})</code> |
| E091 | home/static/js/async/47684.94a3f361.js | `[14980,14996)` | 98345 / showDirAfter | <code>c.ZP.getFileList</code> |
| E092 | home/static/js/async/47684.94a3f361.js | `[14980,14999)` | 98345 / showDirAfter | <code>c.ZP.getFileList(r)</code> |
| E093 | home/static/js/index.a785a6de.js | `[329711,329886)` | 5219 / remove / tZ | <code>function tZ(t){return t.show_hidden=window.localStorage.getItem("".concat(f.Z.state.user.username,"_showHiddenFile"))\|\|0,(0,n.Z)({ …</code> |
| E094 | home/static/js/async/49535.02cfc4ad.js | `[16806,16817)` | 89813 / removeFile | <code>d.ZP.remove</code> |
| E095 | home/static/js/async/49535.02cfc4ad.js | `[16806,16828)` | 89813 / removeFile | <code>d.ZP.remove({paths:t})</code> |
| E096 | home/static/js/async/79367.22d2ea19.js | `[12926,12937)` | 33859 / removeFile | <code>A.ZP.remove</code> |
| E097 | home/static/js/async/79367.22d2ea19.js | `[12926,12948)` | 33859 / removeFile | <code>A.ZP.remove({paths:t})</code> |
| E098 | home/static/js/async/54379.c3a436f0.js | `[36189,36200)` | 43549 / removeFile | <code>h.ZP.remove</code> |
| E099 | home/static/js/async/54379.c3a436f0.js | `[36189,36211)` | 43549 / removeFile | <code>h.ZP.remove({paths:s})</code> |
| E100 | home/static/js/index.a785a6de.js | `[330278,330363)` | 5219 / move / tj | <code>function tj(t){var e=tL(t);return(0,n.Z)({url:"/v2/file/move",method:"post",data:e})}</code> |
| E101 | home/static/js/async/49535.02cfc4ad.js | `[22065,22074)` | 89813 / openDialog | <code>d.ZP.move</code> |
| E102 | home/static/js/async/49535.02cfc4ad.js | `[21833,22134)` | 89813 / openDialog | <code>(0,s._)(function(){var t,e,s,o,a;return(0,n.Jh)(this,function(n){return t=i[0],e=this.checkedList.map(function(t){return t.path}), …</code> |
| E103 | home/static/js/async/79367.22d2ea19.js | `[17754,17763)` | 33859 / openDialog | <code>A.ZP.move</code> |
| E104 | home/static/js/async/79367.22d2ea19.js | `[17522,17823)` | 33859 / openDialog | <code>(0,s._)(function(){var t,e,s,o,n;return(0,a.Jh)(this,function(a){return t=i[0],e=this.checkedList.map(function(t){return t.path}), …</code> |
| E105 | home/static/js/async/54379.c3a436f0.js | `[31947,31956)` | 43549 / recycleOpenDialog | <code>h.ZP.move</code> |
| E106 | home/static/js/async/54379.c3a436f0.js | `[31727,32016)` | 43549 / recycleOpenDialog | <code>(0,s._)(function(){var e,t,s,o,a;return(0,c.Jh)(this,function(r){return e=i[0],t=this.checkedList.map(function(e){return e.path}), …</code> |
| E107 | home/static/js/index.a785a6de.js | `[323985,324063)` | 5219 / restoreAll / W | <code>function W(t){return(0,n.Z)({url:"/v2/file/restoreall",method:"post",data:t})}</code> |
| E108 | home/static/js/async/49535.02cfc4ad.js | `[22362,22377)` | 89813 / openDialog | <code>d.ZP.restoreAll</code> |
| E109 | home/static/js/async/49535.02cfc4ad.js | `[22362,22441)` | 89813 / openDialog | <code>d.ZP.restoreAll({paths:this.extDevRecycleList.map(function(t){return t.path})})</code> |
| E110 | home/static/js/async/49535.02cfc4ad.js | `[22442,22457)` | 89813 / openDialog | <code>d.ZP.restoreAll</code> |
| E111 | home/static/js/async/49535.02cfc4ad.js | `[22442,22485)` | 89813 / openDialog | <code>d.ZP.restoreAll({paths:[this.currentPath]})</code> |
| E112 | home/static/js/async/79367.22d2ea19.js | `[18036,18051)` | 33859 / openDialog | <code>A.ZP.restoreAll</code> |
| E113 | home/static/js/async/79367.22d2ea19.js | `[18036,18079)` | 33859 / openDialog | <code>A.ZP.restoreAll({paths:[this.currentPath]})</code> |
| E114 | home/static/js/index.a785a6de.js | `[326784,326861)` | 5219 / mrestore / tb | <code>function tb(t){return(0,n.Z)({url:"/v2/file/mrestore",method:"post",data:t})}</code> |
| E115 | home/static/js/async/49535.02cfc4ad.js | `[22739,22752)` | 89813 / openDialog | <code>d.ZP.mrestore</code> |
| E116 | home/static/js/async/79367.22d2ea19.js | `[18328,18341)` | 33859 / openDialog | <code>A.ZP.mrestore</code> |
| E117 | home/static/js/async/79367.22d2ea19.js | `[18294,18400)` | 33859 / openDialog | <code>("pub"==this.mode?A.ZP.pubRestore:A.ZP.mrestore)({paths:this.checkedList.map(function(t){return t.path})})</code> |
| E118 | home/static/js/async/54379.c3a436f0.js | `[32283,32296)` | 43549 / recycleOpenDialog | <code>h.ZP.mrestore</code> |
| E119 | home/static/js/async/54379.c3a436f0.js | `[32257,32355)` | 43549 / recycleOpenDialog | <code>("pub"==o?h.ZP.pubRestore:h.ZP.mrestore)({paths:this.checkedList.map(function(e){return e.path})})</code> |
| E120 | home/static/js/index.a785a6de.js | `[326698,326784)` | 5219 / pubRestore / tv | <code>function tv(t){return(0,n.Z)({url:"/v2/public/recycle/restore",method:"post",data:t})}</code> |
| E121 | home/static/js/async/49535.02cfc4ad.js | `[22723,22738)` | 89813 / openDialog | <code>d.ZP.pubRestore</code> |
| E122 | home/static/js/async/79367.22d2ea19.js | `[18312,18327)` | 33859 / openDialog | <code>A.ZP.pubRestore</code> |
| E123 | home/static/js/async/54379.c3a436f0.js | `[32267,32282)` | 43549 / recycleOpenDialog | <code>h.ZP.pubRestore</code> |
| E124 | home/static/js/index.a785a6de.js | `[324382,324463)` | 5219 / restoreFile / K | <code>function K(t){return(0,n.Z)({url:"/v2/file/merge_restore",method:"post",data:t})}</code> |
| E125 | home/static/js/async/49535.02cfc4ad.js | `[22820,22836)` | 89813 / openDialog | <code>d.ZP.restoreFile</code> |
| E126 | home/static/js/index.a785a6de.js | `[324463,324540)` | 5219 / cleanDir / q | <code>function q(t){return(0,n.Z)({url:"/v2/file/empty_dir",method:"post",data:t})}</code> |
| E127 | home/static/js/async/49535.02cfc4ad.js | `[16930,16943)` | 89813 / removeFile | <code>d.ZP.cleanDir</code> |
| E128 | home/static/js/async/49535.02cfc4ad.js | `[16930,17007)` | 89813 / removeFile | <code>d.ZP.cleanDir({paths:this.extDevRecycleList.map(function(t){return t.path})})</code> |
| E129 | home/static/js/async/49535.02cfc4ad.js | `[17008,17021)` | 89813 / removeFile | <code>d.ZP.cleanDir</code> |
| E130 | home/static/js/async/49535.02cfc4ad.js | `[17008,17049)` | 89813 / removeFile | <code>d.ZP.cleanDir({paths:[this.currentPath]})</code> |
| E131 | home/static/js/index.a785a6de.js | `[326304,326379)` | 5219 / rdelall / tp | <code>function tp(t){return(0,n.Z)({url:"/v2/file/rclean",method:"post",data:t})}</code> |
| E132 | home/static/js/async/49535.02cfc4ad.js | `[17070,17082)` | 89813 / removeFile | <code>d.ZP.rdelall</code> |
| E133 | home/static/js/async/49535.02cfc4ad.js | `[17070,17084)` | 89813 / removeFile | <code>d.ZP.rdelall()</code> |
| E134 | home/static/js/async/79367.22d2ea19.js | `[12969,12981)` | 33859 / removeFile | <code>A.ZP.rdelall</code> |
| E135 | home/static/js/async/79367.22d2ea19.js | `[12969,12983)` | 33859 / removeFile | <code>A.ZP.rdelall()</code> |
| E136 | home/static/js/async/54379.c3a436f0.js | `[36224,36236)` | 43549 / removeFile | <code>h.ZP.rdelall</code> |
| E137 | home/static/js/async/54379.c3a436f0.js | `[36224,36238)` | 43549 / removeFile | <code>h.ZP.rdelall()</code> |
| E138 | home/static/js/index.a785a6de.js | `[326379,326463)` | 5219 / cleanPubRecycle / tg | <code>function tg(t){return(0,n.Z)({url:"/v2/public/recycle/clean",method:"post",data:t})}</code> |
| E139 | home/static/js/async/49535.02cfc4ad.js | `[17106,17126)` | 89813 / removeFile | <code>d.ZP.cleanPubRecycle</code> |
| E140 | home/static/js/async/49535.02cfc4ad.js | `[17106,17128)` | 89813 / removeFile | <code>d.ZP.cleanPubRecycle()</code> |
| E141 | home/static/js/async/79367.22d2ea19.js | `[13005,13025)` | 33859 / removeFile | <code>A.ZP.cleanPubRecycle</code> |
| E142 | home/static/js/async/79367.22d2ea19.js | `[13005,13027)` | 33859 / removeFile | <code>A.ZP.cleanPubRecycle()</code> |
| E143 | home/static/js/async/54379.c3a436f0.js | `[36252,36272)` | 43549 / removeFile | <code>h.ZP.cleanPubRecycle</code> |
| E144 | home/static/js/async/54379.c3a436f0.js | `[36252,36274)` | 43549 / removeFile | <code>h.ZP.cleanPubRecycle()</code> |
| E145 | home/static/js/index.a785a6de.js | `[339833,339920)` | 5219 / recycleConfigGet / eT | <code>function eT(t){return(0,n.Z)({url:"/v2/file/recycle/config/get",method:"post",data:t})}</code> |
| E146 | home/static/js/async/51444.3a58c198.js | `[1340,1361)` | 33098 / recycleConfigGet | <code>n.ZP.recycleConfigGet</code> |
| E147 | home/static/js/async/51444.3a58c198.js | `[1340,1363)` | 33098 / recycleConfigGet | <code>n.ZP.recycleConfigGet()</code> |
| E148 | home/static/js/index.a785a6de.js | `[339920,340008)` | 5219 / recycleConfigSave / eE | <code>function eE(t){return(0,n.Z)({url:"/v2/file/recycle/config/save",method:"post",data:t})}</code> |
| E149 | home/static/js/async/51444.3a58c198.js | `[1223,1245)` | 33098 / recycleConfigSave | <code>n.ZP.recycleConfigSave</code> |
| E150 | home/static/js/async/51444.3a58c198.js | `[1223,1248)` | 33098 / recycleConfigSave | <code>n.ZP.recycleConfigSave(c)</code> |
| E151 | home/static/js/index.a785a6de.js | `[377138,377247)` | 52324 / extdevRecycle / object property | <code>extdevRecycle:function t(t){return(0,a.Z)({url:"/api/fileshare_service/samba/recycle",method:"post",data:t})}</code> |
| E152 | home/static/js/async/49535.02cfc4ad.js | `[29849,29867)` | 89813 / getExTDevList | <code>p.ZP.extdevRecycle</code> |
| E153 | home/static/js/async/49535.02cfc4ad.js | `[29849,29941)` | 89813 / getExTDevList | <code>p.ZP.extdevRecycle({type:6,data:JSON.stringify({username:this.$store.state.user.username})})</code> |
| E154 | home/static/js/index.a785a6de.js | `[330600,330678)` | 5219 / taskbyids / t$ | <code>function t$(t){return(0,n.Z)({url:"/v2/file/taskbyids",method:"post",data:t})}</code> |
| E155 | home/static/js/async/49535.02cfc4ad.js | `[17748,17762)` | 89813 / loopTasks | <code>d.ZP.taskbyids</code> |
| E156 | home/static/js/async/49535.02cfc4ad.js | `[17748,17814)` | 89813 / loopTasks | <code>d.ZP.taskbyids({ids:this.syncTasks.map(function(t){return t.id})})</code> |
| E157 | home/static/js/async/79367.22d2ea19.js | `[13647,13661)` | 33859 / loopTasks | <code>A.ZP.taskbyids</code> |
| E158 | home/static/js/async/79367.22d2ea19.js | `[13647,13713)` | 33859 / loopTasks | <code>A.ZP.taskbyids({ids:this.syncTasks.map(function(t){return t.id})})</code> |
| E159 | home/static/js/index.a785a6de.js | `[330678,330754)` | 5219 / taskdel / tW | <code>function tW(t){return(0,n.Z)({url:"/v2/file/taskdel",method:"post",data:t})}</code> |
| E160 | home/static/js/async/49535.02cfc4ad.js | `[20754,20766)` | 89813 / cancelTask | <code>d.ZP.taskdel</code> |
| E161 | home/static/js/async/49535.02cfc4ad.js | `[20754,20793)` | 89813 / cancelTask | <code>d.ZP.taskdel({id:t.currentTaskInfo.id})</code> |
| E162 | home/static/js/async/79367.22d2ea19.js | `[16443,16455)` | 33859 / cancelTask | <code>A.ZP.taskdel</code> |
| E163 | home/static/js/async/79367.22d2ea19.js | `[16443,16482)` | 33859 / cancelTask | <code>A.ZP.taskdel({id:t.currentTaskInfo.id})</code> |
| E164 | home/static/js/index.a785a6de.js | `[330754,330836)` | 5219 / taskContinue / tV | <code>function tV(t){return(0,n.Z)({url:"/v2/file/task/continue",method:"post",data:t})}</code> |
| E165 | home/static/js/async/49535.02cfc4ad.js | `[20905,20922)` | 89813 / continueTask | <code>d.ZP.taskContinue</code> |
| E166 | home/static/js/async/49535.02cfc4ad.js | `[20905,20961)` | 89813 / continueTask | <code>d.ZP.taskContinue({id:this.currentTaskInfo.id,ignore:t})</code> |
| E167 | home/static/js/async/79367.22d2ea19.js | `[16594,16611)` | 33859 / continueTask | <code>A.ZP.taskContinue</code> |
| E168 | home/static/js/async/79367.22d2ea19.js | `[16594,16650)` | 33859 / continueTask | <code>A.ZP.taskContinue({id:this.currentTaskInfo.id,ignore:t})</code> |
| E169 | home/static/js/index.a785a6de.js | `[323031,323177)` | 5219 / getSearchHistory / R | <code>function R(t){return 0&gt;Object.keys(t).indexOf("search_type")&amp;&amp;(t.search_type=1),(0,n.Z)({url:"/file_search/search_log/get",method: …</code> |
| E170 | home/static/js/async/49535.02cfc4ad.js | `[6583,6604)` | 89813 / getSearchHistory | <code>d.ZP.getSearchHistory</code> |
| E171 | home/static/js/async/49535.02cfc4ad.js | `[6544,6744)` | 89813 / getSearchHistory | <code>getSearchHistory:function(){var t=this;d.ZP.getSearchHistory({search_type:1}).then(function(e){e.success&amp;&amp;e.data.list&amp;&amp;e.data.list …</code> |
| E172 | home/static/js/async/49535.02cfc4ad.js | `[6583,6621)` | 89813 / getSearchHistory | <code>d.ZP.getSearchHistory({search_type:1})</code> |
| E173 | home/static/js/async/49535.02cfc4ad.js | `[6906,6927)` | 89813 / clearHistory | <code>d.ZP.getSearchHistory</code> |
| E174 | home/static/js/async/49535.02cfc4ad.js | `[6808,7057)` | 89813 / clearHistory | <code>clearHistory:function(t){var e=this;d.ZP.delSearchHistory({names:[t]}).then(function(t){t.success?d.ZP.getSearchHistory({search_ty …</code> |
| E175 | home/static/js/async/49535.02cfc4ad.js | `[6906,6944)` | 89813 / clearHistory | <code>d.ZP.getSearchHistory({search_type:1})</code> |
| E176 | home/static/js/async/79367.22d2ea19.js | `[5161,5182)` | 33859 / getSearchHistory | <code>A.ZP.getSearchHistory</code> |
| E177 | home/static/js/async/79367.22d2ea19.js | `[5122,5322)` | 33859 / getSearchHistory | <code>getSearchHistory:function(){var t=this;A.ZP.getSearchHistory({search_type:1}).then(function(e){e.success&amp;&amp;e.data.list&amp;&amp;e.data.list …</code> |
| E178 | home/static/js/async/79367.22d2ea19.js | `[5161,5199)` | 33859 / getSearchHistory | <code>A.ZP.getSearchHistory({search_type:1})</code> |
| E179 | home/static/js/async/79367.22d2ea19.js | `[5484,5505)` | 33859 / clearHistory | <code>A.ZP.getSearchHistory</code> |
| E180 | home/static/js/async/79367.22d2ea19.js | `[5386,5635)` | 33859 / clearHistory | <code>clearHistory:function(t){var e=this;A.ZP.delSearchHistory({names:[t]}).then(function(t){t.success?A.ZP.getSearchHistory({search_ty …</code> |
| E181 | home/static/js/async/79367.22d2ea19.js | `[5484,5522)` | 33859 / clearHistory | <code>A.ZP.getSearchHistory({search_type:1})</code> |
| E182 | home/static/js/async/54379.c3a436f0.js | `[7270,7291)` | 43549 / getSearchHistory | <code>h.ZP.getSearchHistory</code> |
| E183 | home/static/js/async/54379.c3a436f0.js | `[7231,7431)` | 43549 / getSearchHistory | <code>getSearchHistory:function(){var e=this;h.ZP.getSearchHistory({search_type:1}).then(function(t){t.success&amp;&amp;t.data.list&amp;&amp;t.data.list …</code> |
| E184 | home/static/js/async/54379.c3a436f0.js | `[7270,7308)` | 43549 / getSearchHistory | <code>h.ZP.getSearchHistory({search_type:1})</code> |
| E185 | home/static/js/async/54379.c3a436f0.js | `[7598,7619)` | 43549 / clearHistory | <code>h.ZP.getSearchHistory</code> |
| E186 | home/static/js/async/54379.c3a436f0.js | `[7500,7749)` | 43549 / clearHistory | <code>clearHistory:function(e){var t=this;h.ZP.delSearchHistory({names:[e]}).then(function(e){e.success?h.ZP.getSearchHistory({search_ty …</code> |
| E187 | home/static/js/async/54379.c3a436f0.js | `[7598,7636)` | 43549 / clearHistory | <code>h.ZP.getSearchHistory({search_type:1})</code> |
| E188 | home/static/js/index.a785a6de.js | `[322882,323031)` | 5219 / delSearchHistory / B | <code>function B(t){return 0&gt;Object.keys(t).indexOf("search_type")&amp;&amp;(t.search_type=1),(0,n.Z)({url:"/file_search/search_log/delete",meth …</code> |
| E189 | home/static/js/async/49535.02cfc4ad.js | `[6844,6865)` | 89813 / clearHistory | <code>d.ZP.delSearchHistory</code> |
| E190 | home/static/js/async/49535.02cfc4ad.js | `[6844,6878)` | 89813 / clearHistory | <code>d.ZP.delSearchHistory({names:[t]})</code> |
| E191 | home/static/js/async/79367.22d2ea19.js | `[5422,5443)` | 33859 / clearHistory | <code>A.ZP.delSearchHistory</code> |
| E192 | home/static/js/async/79367.22d2ea19.js | `[5422,5456)` | 33859 / clearHistory | <code>A.ZP.delSearchHistory({names:[t]})</code> |
| E193 | home/static/js/async/54379.c3a436f0.js | `[7536,7557)` | 43549 / clearHistory | <code>h.ZP.delSearchHistory</code> |
| E194 | home/static/js/async/54379.c3a436f0.js | `[7536,7570)` | 43549 / clearHistory | <code>h.ZP.delSearchHistory({names:[e]})</code> |
| E195 | home/static/js/index.a785a6de.js | `[338739,338997)` | 5219 / slowFileSearchStart / ew | <code>function ew(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]?arguments[0]:{};return t.show_hidden=window.localStorage.getItem("". …</code> |
| E196 | home/static/js/async/54379.c3a436f0.js | `[14141,14165)` | 43549 / noIndexSearch | <code>h.ZP.slowFileSearchStart</code> |
| E197 | home/static/js/async/54379.c3a436f0.js | `[14141,14168)` | 43549 / noIndexSearch | <code>h.ZP.slowFileSearchStart(i)</code> |
| E198 | home/static/js/index.a785a6de.js | `[338997,339260)` | 5219 / slowFileSearchStartGetResult / eC | <code>function eC(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]?arguments[0]:{};return t.show_hidden=window.localStorage.getItem("". …</code> |
| E199 | home/static/js/async/54379.c3a436f0.js | `[14401,14434)` | 43549 / noIndexSearch | <code>h.ZP.slowFileSearchStartGetResult</code> |
| E200 | home/static/js/async/54379.c3a436f0.js | `[14401,14480)` | 43549 / noIndexSearch | <code>h.ZP.slowFileSearchStartGetResult({taskid:this.taskid,start:t.start,num:t.num})</code> |
| E201 | home/static/js/index.a785a6de.js | `[339260,339417)` | 5219 / slowFileSearchStartStop / ex | <code>function ex(){var t=arguments.length&gt;0&amp;&amp;void 0!==arguments[0]?arguments[0]:{};return(0,n.Z)({url:"/file_search/slow_file_search/st …</code> |
| E202 | home/static/js/async/54379.c3a436f0.js | `[13213,13241)` | 43549 / noIndexSearchStop | <code>h.ZP.slowFileSearchStartStop</code> |
| E203 | home/static/js/async/54379.c3a436f0.js | `[13213,13263)` | 43549 / noIndexSearchStop | <code>h.ZP.slowFileSearchStartStop({taskid:this.taskid})</code> |
| E204 | home/static/js/index.a785a6de.js | `[325785,325969)` | 5219 / fileSearch / tc | <code>function tc(t){return t.show_hidden=window.localStorage.getItem("".concat(f.Z.state.user.username,"_showHiddenFile"))\|\|0,(0,n.Z)({ …</code> |
| E205 | home/static/js/async/54379.c3a436f0.js | `[15998,16013)` | 43549 / search | <code>h.ZP.fileSearch</code> |
| E206 | home/static/js/async/54379.c3a436f0.js | `[15998,16016)` | 43549 / search | <code>h.ZP.fileSearch(o)</code> |
| E207 | home/static/js/async/47684.94a3f361.js | `[13269,13284)` | 98345 / showDirAfter | <code>c.ZP.fileSearch</code> |
| E208 | home/static/js/async/47684.94a3f361.js | `[13269,13287)` | 98345 / showDirAfter | <code>c.ZP.fileSearch(i)</code> |
| E209 | home/static/js/index.a785a6de.js | `[327205,327299)` | 5219 / getGroupList / tw | <code>function tw(t){return(0,n.Z)({url:"/v2/public/group/list",method:"post",data:t,timeout:15e3})}</code> |
| E210 | home/static/js/async/47684.94a3f361.js | `[13904,13921)` | 98345 / showDirAfter | <code>c.ZP.getGroupList</code> |
| E211 | home/static/js/async/47684.94a3f361.js | `[13904,13924)` | 98345 / showDirAfter | <code>c.ZP.getGroupList(r)</code> |
| E212 | home/static/js/index.a785a6de.js | `[328066,328467)` | 5219 / getFileListStream / tP | <code>function tP(t){return Object.prototype.hasOwnProperty.call(t,"show_hidden")\|\|(t.show_hidden=window.localStorage.getItem("".concat( …</code> |
| E213 | home/static/js/async/47684.94a3f361.js | `[14936,14958)` | 98345 / showDirAfter | <code>c.ZP.getFileListStream</code> |
| E214 | home/static/js/async/47684.94a3f361.js | `[14936,14961)` | 98345 / showDirAfter | <code>c.ZP.getFileListStream(r)</code> |
| E215 | home/static/js/index.a785a6de.js | `[351259,351398)` | 74168 / getShareSetting / l | <code>function l(t){return(0,a._)(function(){return(0,i.Jh)(this,function(e){return[2,(0,n.Z)({url:"/setting/load",method:"post",data:t} …</code> |
| E216 | home/static/js/async/47684.94a3f361.js | `[4986,5006)` | 98345 / initDefaultSort | <code>p.ZP.getShareSetting</code> |
| E217 | home/static/js/async/47684.94a3f361.js | `[4986,5008)` | 98345 / initDefaultSort | <code>p.ZP.getShareSetting()</code> |
| E218 | home/static/js/async/86742.45029e7d.js | `[11331,11413)` | 14530 / getSetting / f | <code>function f(t){return(0,n.Z)({url:"/downloader/get/setting",method:"post",data:t})}</code> |
| E219 | home/static/js/async/47684.94a3f361.js | `[19992,19996)` | 98345 / getDefaultDownloadDir | <code>h.$8</code> |
| E220 | home/static/js/async/47684.94a3f361.js | `[19989,19999)` | 98345 / getDefaultDownloadDir | <code>(0,h.$8)()</code> |
| E221 | home/static/js/index.a785a6de.js | `[285444,285836)` | 74922 / getPreviewUrl / r | <code>function r(t){var e=arguments.length&gt;1&amp;&amp;void 0!==arguments[1]?arguments[1]:"small";return(t.dest_fmt=e,t.request_purpose=5,window. …</code> |
| E222 | home/static/js/async/49535.02cfc4ad.js | `[15226,15230)` | 89813 / getFileList | <code>h.pC</code> |
| E223 | home/static/js/async/49535.02cfc4ad.js | `[15223,15260)` | 89813 / getFileList | <code>(0,h.pC)({file_path:t.path,s:t.size})</code> |
| E224 | home/static/js/async/49535.02cfc4ad.js | `[30734,30738)` | 89813 / getExTDevList | <code>h.pC</code> |
| E225 | home/static/js/async/49535.02cfc4ad.js | `[30731,30768)` | 89813 / getExTDevList | <code>(0,h.pC)({file_path:t.path,s:t.size})</code> |
| E226 | home/static/js/async/79367.22d2ea19.js | `[11384,11388)` | 33859 / getFileList | <code>h.pC</code> |
| E227 | home/static/js/async/79367.22d2ea19.js | `[11381,11418)` | 33859 / getFileList | <code>(0,h.pC)({file_path:e.path,s:e.size})</code> |
| E228 | home/static/js/async/54379.c3a436f0.js | `[17234,17238)` | 43549 / search | <code>p.pC</code> |
| E229 | home/static/js/async/54379.c3a436f0.js | `[17231,17268)` | 43549 / search | <code>(0,p.pC)({file_path:e.path,s:e.size})</code> |
| E230 | home/static/js/async/47684.94a3f361.js | `[16230,16248)` | 98345 / showDirAfter | <code>n.ZP.getPreviewUrl</code> |
| E231 | home/static/js/async/47684.94a3f361.js | `[16230,16277)` | 98345 / showDirAfter | <code>n.ZP.getPreviewUrl({file_path:t.path,s:t.size})</code> |
| E232 | home/static/js/index.a785a6de.js | `[326622,326698)` | 5219 / restore / t_ | <code>function t_(t){return(0,n.Z)({url:"/v2/file/restore",method:"post",data:t})}</code> |
| E233 | home/static/js/index.a785a6de.js | `[324540,324622)` | 5219 / getRecycleExtDev / J | <code>function J(t){return(0,n.Z)({url:"/settings?root_list=true",method:"get",data:t})}</code> |
| E234 | home/static/js/index.a785a6de.js | `[328467,328805)` | 5219 / getNbFileList / tT | <code>function tT(t){return t.show_hidden=window.localStorage.getItem("".concat(f.Z.state.user.username,"_showHiddenFile"))\|\|0,"mac"==wi …</code> |
| E235 | home/static/js/index.a785a6de.js | `[317635,319100)` | 5219 / 5219.h stream fetch helper | <code>h=function(t){return(0,r._)(function(){var e,s,a,o,i,n,r,d,h,f,_,v,b,k,y;return(0,l.Jh)(this,function(A){switch(A.label){case 0:re …</code> |

## Verification

All selected/referenced sources parsed with Babel without executing target code. All235 evidence ranges were checked against original UTF-16 string slices; all30 method/path keys are distinct. All16 parsed carriers matched the SHA256 manifest and saved snapshot. No broader tests, runtime checks, installations or edits to other outputs were performed.

