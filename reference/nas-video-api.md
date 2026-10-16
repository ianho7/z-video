# 你的 NAS极影视 API 目录

来源：`http://192.168.5.2:5055/home/`，2026-10-16 获取的公开静态脚本。NAS 前端版本端点返回 `2.3.2026082801`。

共 197 个去重的 HTTP 方法/路径，207 个包装函数。所有请求均未执行。参数列给出包装函数转发方式与静态调用例；必填项、后端完整 schema 和运行权限仍须真实响应确认。路径相同且请求方法相同只计算一次。

| 方法 | 路径 | 包装方法/导出 | 调用例 | 来源及 UTF-16 偏移 |
|---|---|---|---|---|
| POST | `/zvideo/settings/suggested` | n | `(0,a.To)(c)` | home/static/js/async/53914.d64301c5.js:530 |
| POST | `/zvideo/collection/skip` | r | `(0,p.F0)({collection_id:this.collection_id,previous:i,start:s,end:o,preview:r,selected:1})` | home/static/js/async/53914.d64301c5.js:643 |
| POST | `/zvideo/collection/filter/v2` | d | `(0,a.GY)()` | home/static/js/async/53914.d64301c5.js:725 |
| POST | `/zvideo/tmdb/settings/load` | a | `(0,d.kp)()` | home/static/js/async/53914.d64301c5.js:812 |
| POST | `/zvideo/tmdb/validate/key` | u | `(0,m.Kb)({api_key:this.newTmdbKey})` | home/static/js/async/53914.d64301c5.js:897 |
| POST | `/zvideo/tmdb/settings` | s | `(0,m.ef)({set_key:t,set_value:e})` | home/static/js/async/53914.d64301c5.js:981 |
| POST | `/zvideo/video/media` | l | `(0,n.a7)({file_path:this.videoPath})` | home/static/js/async/53914.d64301c5.js:1061 |
| POST | `/subs/v2/searchsub` | c | `(0,d.eN)({q:e})` | home/static/js/async/53914.d64301c5.js:1139 |
| POST | `/subs/v2/preview` | f | `(0,d._n)({sub_id:t.sub_id,download_url:t.download_url})` | home/static/js/async/53914.d64301c5.js:1216 |
| POST | `/subs/v2/downloadsub` | p | `(0,d.Se)({sub_id:this.curSubInfo.sub_id,download_url:this.curSubInfo.download_url,sub_title:t.sub_title,file_name:this.videoPath,encrypted_path:this.encrypted_path,from:"zvideo"})` | home/static/js/async/53914.d64301c5.js:1375 |
| POST | `/subs/prematch` | h | `(0,n.F1)({download_url:this.curSubInfo.download_url})` | home/static/js/async/53914.d64301c5.js:1475 |
| POST | `/subs/batchdownload` | m | `(0,d.NN)({matched:JSON.stringify(this.validMatchedList.map(function(t){return{sub_path:t.sub_path,file_path:t.file_path}}))})` | home/static/js/async/53914.d64301c5.js:1560 |
| POST | `/zvideo/settings/load` | v, settingsLoad | `(0,p.vr)({key:"skip"})` | home/static/js/async/53914.d64301c5.js:1650 |
| POST | `/zvideo/settings/set` | Z, settingsSet | `(0,p.cL)({key:"skip",value:t?1:2})` | home/static/js/async/53914.d64301c5.js:1730 |
| POST | `/zvideo/classification/file/browser` | z | `(0,d.E8)(o)` | home/static/js/async/53914.d64301c5.js:1809 |
| POST | `/zvideo/classification/list` | getSiderBar | `d.ZP.getSiderBar()` | home/static/js/async/53914.d64301c5.js:1919 |
| POST | `/zvideo/video/v2/list` | getList | `d.ZP.getList({classification_id:this.operateCollectionItem.classification_id,start:this.start,limit:this.limit,system:7})` | home/static/js/async/53914.d64301c5.js:2012 |
| POST | `/zvideo/collection/v2/info` | getInfo | `d.ZP.getInfo({collection_id:t.collection_id,get_type:"all",classification_id:t.classification_id})` | home/static/js/async/53914.d64301c5.js:2099 |
| POST | `/zvideo/search/cloud` | cloudSearch | `l.ZP.cloudSearch(i)` | home/static/js/async/53914.d64301c5.js:2195 |
| POST | `/zvideo/tmdb/search` | cloudTmdbSearch | `l.ZP.cloudTmdbSearch(e)` | home/static/js/async/53914.d64301c5.js:2289 |
| POST | `/zvideo/tmdb/search/people` | cloudSearchPeople | `s.ZP.cloudSearchPeople({name:this.searchPeopleKey,page:this.searchPage})` | home/static/js/async/53914.d64301c5.js:2384 |
| POST | `/zvideo/search/local` | nasSearch | `n.ZP.nasSearch({key_word:this.searchTitle,classification_id:this.seriesInfo.classification_id})` | home/static/js/async/53914.d64301c5.js:2478 |
| POST | `/zvideo/classification/increase` | addContent | `d.ZP.addContent({classification_id:this.classification_id,file_path:i})` | home/static/js/async/53914.d64301c5.js:2567 |
| POST | `/zvideo/collection/correct` | correctMeta | `d.ZP.correctMeta({collection_id:e.id,classification_id:e.classification_id,zrid:t})` | home/static/js/async/53914.d64301c5.js:2668 |
| POST | `/zvideo/collection/seen/add` | look | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:2757 |
| POST | `/zvideo/collection/seen/delete` | unlook | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:2849 |
| POST | `/zvideo/video/like` | like | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:2942 |
| POST | `/zvideo/video/unlike` | unlike | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:3025 |
| POST | `/zvideo/collection/ruleout` | deleteEpisode | `n.ZP.deleteEpisode({collection_id:this.collection_id,classification_id:this.classification_id,video_id:e.video_id})` | home/static/js/async/53914.d64301c5.js:3117 |
| POST | `/zvideo/collection/modify` | modifyEpisode | `n.ZP.modifyEpisode({collection_id:t.collection_id,classification_id:t.classification_id,file_path:e.file_path,video_id:e.video_id,episode:i})` | home/static/js/async/53914.d64301c5.js:3215 |
| POST | `/zvideo/collection/del` | deleteCollection | `d.ZP.deleteCollection({collection_id:this.id,classification_id:this.classification_id})` | home/static/js/async/53914.d64301c5.js:3315 |
| POST | `/zvideo/classification/del` | delClassify | `l.ZP.delClassify({classification_id:this.operateId})` | home/static/js/async/53914.d64301c5.js:3407 |
| POST | `/zvideo/video/randomlist` | randomlist, randomlist_old | `d.ZP.randomlist_old({limit:48,classification_id:this.classification_id,collection_id:this.videoInfo.collection_id})` | home/static/js/async/53914.d64301c5.js:3502 |
| POST | `/zvideo/share/v2/randomlist` | randomsharelist | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:3600 |
| POST | `/zvideo/classification/add` | addClassify | `d.ZP.addClassify({classification_name:this.classifyName,file_path:i,share_users:JSON.stringify(s),not_scrape:+!!this.addClassWithNoScrape})` | home/static/js/async/53914.d64301c5.js:3697 |
| POST | `/zvideo/video/updateplaytime` | updateplaytime | `d.ZP.updateplaytime({classification_id:this.classification_id,collection_id:this.id,video_id:this.videoInfo.video_list[0].video_id,sec:this.lastPlay.play_duration?this.lastPlay.play_duration:-2,chapter:this.lastPlay.play_chapter//"",subtitle_setting:this.lastPlay.subtitle_setting//"",audio_index:this.lastPlay.audio_index,subtitle_index:this.lastPlay.subtitle_index,subtitle_hash:this.lastPlay.subtitle_hash})` | home/static/js/async/53914.d64301c5.js:3796 |
| POST | `/zvideo/video/unclassifiedlist` | sysManage | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:3892 |
| POST | `/zvideo/classification/auto` | sysAddClassify | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:3995 |
| POST | `/zvideo/record/info` | classifyInfo | `d.ZP.classifyInfo({classification_id:this.classification_id})` | home/static/js/async/53914.d64301c5.js:4093 |
| POST | `/zvideo/record/list` | settingList | `l.ZP.settingList()` | home/static/js/async/53914.d64301c5.js:4182 |
| POST | `/zvideo/classification/editname` | changeClassify | `l.ZP.changeClassify({classification_id:this.operateId,classification_name:this.newName})` | home/static/js/async/53914.d64301c5.js:4274 |
| POST | `/zvideo/classification/rmdir` | rmDir | `d.ZP.rmDir({classification_id:this.classification_id,file_path:this.videoInfo.collection_path[0].path})` | home/static/js/async/53914.d64301c5.js:4369 |
| POST | `/zvideo/share/v3/list` | shareList | `h.ZP.shareList({limit:this.start+this.limit,start:1,type:this.typeVal,field:this.sortVal//"release_year"})` | home/static/js/async/53914.d64301c5.js:4477 |
| POST | `/zvideo/scraper/result` | betterResult | `d.ZP.betterResult({task_id:t})` | home/static/js/async/53914.d64301c5.js:4569 |
| POST | `/zvideo/share/v3/info` | getShareInfo | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:4662 |
| POST | `/zvideo/share/v2/lastplay` | shareLastplay | `h.ZP.shareLastplay()` | home/static/js/async/53914.d64301c5.js:4755 |
| POST | `/zvideo/share/updateplaytime` | updateshareplay | `p.ZP.updateshareplay({collection_id:this.reportInfo.collection_id,video_id:this.videoId,sec:1e3*i})` | home/static/js/async/53914.d64301c5.js:4854 |
| POST | `/zvideo/scraper/op` | better | `d.ZP.better({classification_id:t})` | home/static/js/async/53914.d64301c5.js:4947 |
| POST | `/zvideo/classification/isrefresh` | isRefresh | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:5033 |
| POST | `/zvideo/video/v2/playlist` | playRecordList | `d.ZP.playRecordList({limit:0,start:1})` | home/static/js/async/53914.d64301c5.js:5138 |
| POST | `/zvideo/record/rlist` | getRList | `d.ZP.getRList({classification_id:t.classification_id})` | home/static/js/async/53914.d64301c5.js:5230 |
| POST | `/zvideo/classification/checkaddstatus` | isAdding | `d.ZP.isAdding({classification_id:t})` | home/static/js/async/53914.d64301c5.js:5317 |
| POST | `/zvideo/video/v2/lately` | addList | `d.ZP.addList({limit:0,start:1,system:0})` | home/static/js/async/53914.d64301c5.js:5420 |
| POST | `/zvideo/collection/move` | changeClass | `d.ZP.changeClass({collection_id:this.changeItem.collection_id,classification_id:this.changeItem.classification_id,new_classification_id:this.changeCheckedId})` | home/static/js/async/53914.d64301c5.js:5513 |
| POST | `/zvideo/collection/split` | dirSplit, removeInfo | `d.ZP.dirSplit({collection_id:this.id,classification_id:this.classification_id})` | home/static/js/async/53914.d64301c5.js:5603 |
| POST | `/zvideo/share/record/list` | settingShareList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:5702 |
| POST | `/zvideo/share/v2/new/status` | getShareStatus | `h.ZP.getShareStatus()` | home/static/js/async/53914.d64301c5.js:5800 |
| POST | `/zvideo/share/record/remove` | rmShareDir | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:5896 |
| POST | `/zvideo/share/record/new` | addShareDir | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:5993 |
| POST | `/zvideo/classification/mode` | getMode | `d.ZP.getMode()` | home/static/js/async/53914.d64301c5.js:6083 |
| POST | `/zvideo/classification/mode/set` | setMode | `d.ZP.setMode({classification_mode:this.classification_mode_check})` | home/static/js/async/53914.d64301c5.js:6188 |
| POST | `/zvideo/classification/hide` | setTvHide | `l.ZP.setTvHide({classification_id:this.info.classification_id,tv:+!!t})` | home/static/js/async/53914.d64301c5.js:6287 |
| POST | `/zvideo/favorite/list` | collectList | `d.ZP.collectList({limit:0,start:1})` | home/static/js/async/53914.d64301c5.js:6384 |
| POST | `/zvideo/collection/filter` | filter | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:6470 |
| POST | `/zvideo/favorite/add` | collect | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:6573 |
| POST | `/zvideo/favorite/delete` | uncollect | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:6661 |
| POST | `/zvideo/collection/version/add` | addVersion | `d.ZP.addVersion({collection_id:t.videoInfo.collection_id,classification_id:t.videoInfo.classification_id,path:i[0]})` | home/static/js/async/53914.d64301c5.js:6753 |
| POST | `/zvideo/collection/version/remove` | removeVersion | `d.ZP.removeVersion({collection_id:this.videoInfo.collection_id,classification_id:this.videoInfo.classification_id,version_id:this.removeVersionItem.version_id})` | home/static/js/async/53914.d64301c5.js:6855 |
| POST | `/zvideo/collection/optimization` | fixCollection | `d.ZP.fixCollection({collection_id:t.collection_id,classification_id:t.classification_id})` | home/static/js/async/53914.d64301c5.js:6960 |
| POST | `/zvideo/classification/dirs` | getAllAddList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:7063 |
| POST | `/zvideo/classification/multihide` | multihide | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:7158 |
| POST | `/zvideo/share/v4/list` | getShareClass | `n.ZP.getShareClass({state:3})` | home/static/js/async/53914.d64301c5.js:7262 |
| POST | `/zvideo/share/v4/set` | setShareClass | `d.ZP.setShareClass({classification_id:this.shareClassInfo.id,share_users:JSON.stringify(this.selectUserArr)})` | home/static/js/async/53914.d64301c5.js:7355 |
| POST | `/zvideo/share/v4/collection/list` | getShareClassList | `h.ZP.getShareClassList(e)` | home/static/js/async/53914.d64301c5.js:7451 |
| POST | `/zvideo/share/v4/collection/info` | getShareClassDetail | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:7561 |
| POST | `/zvideo/series/upload/cover` | uploadCover | `d.ZP.uploadCover(i)` | home/static/js/async/53914.d64301c5.js:7710 |
| POST | `/zvideo/series/download/cover` | downloadCover | `d.ZP.downloadCover({cover_url:this.createCollectionInfo.coverMap.type2.inputModel})` | home/static/js/async/53914.d64301c5.js:7809 |
| POST | `/zvideo/series/select/cover` | selectSeriesCover | `a.ZP.selectSeriesCover({cover:o[0]})` | home/static/js/async/53914.d64301c5.js:7914 |
| POST | `/zvideo/series/add` | addCollection | `d.ZP.addCollection(e)` | home/static/js/async/53914.d64301c5.js:8013 |
| POST | `/zvideo/series/list` | seriesList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:8100 |
| POST | `/zvideo/series/collection/list` | seriesDetail | `d.ZP.seriesDetail(i)` | home/static/js/async/53914.d64301c5.js:8190 |
| POST | `/zvideo/series/delete` | deleteSeries | `d.ZP.deleteSeries({series_id:this.series_id,classification_id:this.classification_id})` | home/static/js/async/53914.d64301c5.js:8291 |
| POST | `/zvideo/series/collection/add` | addToSeries | `n.ZP.addToSeries({series_id:this.seriesInfo.series_id,classification_id:this.seriesInfo.classification_id,collection_id:JSON.stringify(e)})` | home/static/js/async/53914.d64301c5.js:8382 |
| POST | `/zvideo/series/edit` | editSeries | `d.ZP.editSeries(e)` | home/static/js/async/53914.d64301c5.js:8480 |
| POST | `/zvideo/share/v4/series/collection/list` | shareSeriesDetail | `d.ZP.shareSeriesDetail(i)` | home/static/js/async/53914.d64301c5.js:8575 |
| POST | `/zvideo/share/v4/series/list` | shareSeriesList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:8688 |
| POST | `/zvideo/series/collection/delete` | removeFromSeries | `d.ZP.removeFromSeries({classification_id:this.operateCollectionItem.classification_id,collection_id:this.operateCollectionItem.collection_id})` | home/static/js/async/53914.d64301c5.js:8791 |
| POST | `/zvideo/collection/add` | addDiyCollection, createDiyCollection | `d.ZP.addDiyCollection(i)` | home/static/js/async/53914.d64301c5.js:8898 |
| POST | `/zvideo/collection/edit` | editDiyCollection, editDiy, editDiyCollectionv2 | `d.ZP.editDiy(e)` | home/static/js/async/53914.d64301c5.js:8996 |
| POST | `/zvideo/collection/dismiss` | delDiyCollection | `d.ZP.delDiyCollection({collection_id:this.delDiyItem.collection_id,classification_id:this.delDiyItem.classification_id})` | home/static/js/async/53914.d64301c5.js:9094 |
| POST | `/zvideo/collection/add/file` | addToDiy | `d.ZP.addToDiy({collection_id:t.collection_id,classification_id:t.classification_id,file_path:s})` | home/static/js/async/53914.d64301c5.js:9200 |
| POST | `/zvideo/collection/upload/cover` | uploadDiyCover | `d.ZP.uploadDiyCover(i)` | home/static/js/async/53914.d64301c5.js:9436 |
| POST | `/zvideo/collection/download/cover` | downloadDiyCover | `d.ZP.downloadDiyCover({cover_url:this.createCollectionInfo.coverMap.type2.inputModel})` | home/static/js/async/53914.d64301c5.js:9542 |
| POST | `/zvideo/collection/select/cover` | selectDiyCover | `l.ZP.selectDiyCover({cover:t[0]})` | home/static/js/async/53914.d64301c5.js:9648 |
| POST | `/zvideo/collection/file/list` | diyFileList | `d.ZP.diyFileList({collection_id:this.diyInfo.collection_id})` | home/static/js/async/53914.d64301c5.js:9749 |
| POST | `/zvideo/collection/delete/file` | detailDiyFile, diyCollectionRemoveFile | `d.ZP.detailDiyFile({collection_id:t.collection_id,file_path:t.path})` | home/static/js/async/53914.d64301c5.js:9849 |
| POST | `/zvideo/collection/alter` | changeToDiy | `d.ZP.changeToDiy({custom_collection_id:e[0],classification_id:this.operateClassId,collection_id:this.AddToDiyCollectionId})` | home/static/js/async/53914.d64301c5.js:10042 |
| POST | `/zvideo/record/file/list` | contentManageList | `a.ZP.contentManageList()` | home/static/js/async/53914.d64301c5.js:10154 |
| POST | `/zvideo/classification/checkextdevstatus` | checkExtDevStatus | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:10254 |
| POST | `/zvideo/classification/rescan` | classificationRescan | `d.ZP.classificationRescan((0,o._)({classification_id:e},t?{file_path:[t]}:{}))` | home/static/js/async/53914.d64301c5.js:10373 |
| POST | `/zvideo/classification/rescan/result` | classificationRescanTask | `d.ZP.classificationRescanTask({task_id:t})` | home/static/js/async/53914.d64301c5.js:10485 |
| POST | `/zvideo/classification/customsort` | changeClassSort | `l.ZP.changeClassSort({classification_id:i})` | home/static/js/async/53914.d64301c5.js:10595 |
| POST | `/zvideo/video/playlist/delete` | memoryClean | `h.ZP.memoryClean({playlist:JSON.stringify(i)})` | home/static/js/async/53914.d64301c5.js:10698 |
| POST | `/zvideo/video/playlist/clear` | memoryCleanAll | `h.ZP.memoryCleanAll()` | home/static/js/async/53914.d64301c5.js:10800 |
| POST | `/zvideo/video/person/list` | personAlbumList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:10902 |
| GET | `/zvideo/services/status` | servicesStatus | `d.ZP.servicesStatus({})` | home/static/js/async/53914.d64301c5.js:11000 |
| POST | `/zvideo/task/quit` | taskQuit | `d.ZP.taskQuit({classification_id:t})` | home/static/js/async/53914.d64301c5.js:11091 |
| POST | `/zvideo/collection/report` | collectionReport | `d.ZP.collectionReport(this.reportSetting.data)` | home/static/js/async/53914.d64301c5.js:11183 |
| POST | `/zvideo/share/collection/list` | getShareCollectionList | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:11289 |
| POST | `/zvideo/share/collection/delete` | collectionDelete | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:11393 |
| POST | `/zvideo/share/collection/delete/by` | collectionDeleteBy | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:11501 |
| POST | `/zvideo/share/collection/modify` | collectionModify | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:11610 |
| POST | `/zvideo/share/collection/modify/by` | collectionModifyBy | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:11718 |
| POST | `/zvideo/record/notreadd/list` | allDirInZvideoWithClassInfoList | `d.ZP.allDirInZvideoWithClassInfoList({not_scrape:+!!this.addClassWithNoScrape})` | home/static/js/async/53914.d64301c5.js:11842 |
| POST | `/zvideo/collection/file/remove` | collectionRemoveFile | `s.ZP.collectionRemoveFile({collection_id:e.currentItem.collection_id,classification_id:e.currentItem.classification_id,file_path:e.checkedList})` | home/static/js/async/53914.d64301c5.js:12061 |
| POST | `/zvideo/collection/episode` | changeEp | `s.ZP.changeEp({collection_id:this.currentItem.collection_id,data:JSON.stringify(t)})` | home/static/js/async/53914.d64301c5.js:12158 |
| POST | `/zvideo/collection/file/rematch` | fileMatch | `d.ZP.fileMatch({zrid:t,file_path:[i.file_path],classification_id:o})` | home/static/js/async/53914.d64301c5.js:12252 |
| POST | `/zvideo/search/celebrity` | searchPeople | `s.ZP.searchPeople({name:this.searchPeopleKey})` | home/static/js/async/53914.d64301c5.js:12466 |
| POST | `/zvideo/collection/upload/backdrop` | uploadBackdrop | `l.ZP.uploadBackdrop(t)` | home/static/js/async/53914.d64301c5.js:12610 |
| POST | `/zvideo/collection/download/backdrop` | downloadBackdrop | `l.ZP.downloadBackdrop({backdrop_url:this.highLvModeCoverInfo.backdropMap.type2.inputModel})` | home/static/js/async/53914.d64301c5.js:12719 |
| POST | `/zvideo/collection/select/backdrop` | selectDiyBackdrop | `l.ZP.selectDiyBackdrop({backdrop:t[0]})` | home/static/js/async/53914.d64301c5.js:12831 |
| POST | `/zvideo/classification/series` | autoSeriesSwitch | `l.ZP.autoSeriesSwitch({classification_id:i.info.classification_id,auto_series:1})` | home/static/js/async/53914.d64301c5.js:13041 |
| POST | `/zvideo/classification/series/result` | autoSeriesTask | `d.ZP.autoSeriesTask({task_id:t})` | home/static/js/async/53914.d64301c5.js:13143 |
| POST | `/zvideo/tmdb/search/seasons` | getSeasons | `l.ZP.getSeasons({zrid:t.zrid})` | home/static/js/async/53914.d64301c5.js:13248 |
| POST | `/zvideo/home/collection/suggested` | recommendation | `r.ZP.recommendation({limit:31,backdrop:1})` | home/static/js/async/53914.d64301c5.js:13348 |
| POST | `/zvideo/collection/info` | getInfoV2 | `d.ZP.getInfoV2({collection_id:i.collection_id,classification_id:i.classification_id})` | home/static/js/async/53914.d64301c5.js:13449 |
| POST | `/zvideo/collection/video` | collectionVideoList | `d.ZP.collectionVideoList({collection_id:t.collection_id,classification_id:t.classification_id})` | home/static/js/async/53914.d64301c5.js:13550 |
| POST | `/zvideo/person/collection/list` | personInfo | `d.ZP.personInfo(this.videoList_params)` | home/static/js/async/53914.d64301c5.js:13643 |
| POST | `/zvideo/collection/person` | personList | `d.ZP.personList({collection_id:this.id})` | home/static/js/async/53914.d64301c5.js:13742 |
| POST | `/zvideo/share/classification/collection/info` | getShareInfoV2 | `d.ZP.getShareInfoV2(s)` | home/static/js/async/53914.d64301c5.js:13840 |
| POST | `/zvideo/share/classification/collection/video` | shareCollectionVideoList | `d.ZP.shareCollectionVideoList({collection_id:i.collection_id,classification_id:i.classification_id})` | home/static/js/async/53914.d64301c5.js:13967 |
| POST | `/zvideo/home/share/collection/latest` | homePageShareList | `r.ZP.homePageShareList({limit:30})` | home/static/js/async/53914.d64301c5.js:14088 |
| POST | `/zvideo/home/collection/latest` | homePageAddList | `r.ZP.homePageAddList({limit:30})` | home/static/js/async/53914.d64301c5.js:14198 |
| POST | `/zvideo/settings/suggested/load` | getRecommendSetting | `a.ZP.getRecommendSetting()` | home/static/js/async/53914.d64301c5.js:14325 |
| POST | `/zvideo/task/result` | classificationSyncTask | `h.ZP.classificationSyncTask({task_id:t.task_id})` | home/static/js/async/53914.d64301c5.js:14437 |
| POST | `/zvideo/search/index` | search | `s.ZP.search({key_word:this.searchText})` | home/static/js/async/53914.d64301c5.js:14521 |
| POST | `/zvideo/search/suggest` | searchSuggest | `h.ZP.searchSuggest({key_word:this.searchKey})` | home/static/js/async/53914.d64301c5.js:14662 |
| GET | `/transcode/video/streams` | getVideoStreamInfo | `d.ZP.getVideoStreamInfo({file_path:e})` | home/static/js/async/53914.d64301c5.js:14761 |
| GET | `/transcode/decrypt/video/streams` | getVideoEncryptedStreamInfo | `d.ZP.getVideoEncryptedStreamInfo({encrypted_path:e,from:"zvideo"})` | home/static/js/async/53914.d64301c5.js:14872 |
| POST | `/zvideo/settings/sort/load` | getDefaultSort | `d.ZP.getDefaultSort({key:t})` | home/static/js/async/53914.d64301c5.js:14978 |
| POST | `/zvideo/settings/sort` | setDefaultSort | `d.ZP.setDefaultSort(e)` | home/static/js/async/53914.d64301c5.js:15077 |
| POST | `/zvideo/skip/enable` | skipEnable | `d.ZP.skipEnable(i)` | home/static/js/async/53914.d64301c5.js:15167 |
| POST | `/zvideo/skip/set` | skipSet | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/async/53914.d64301c5.js:15252 |
| POST | `/zvideo/skip/classification` | skipClassification | `d.ZP.skipClassification(e)` | home/static/js/async/53914.d64301c5.js:15345 |
| POST | `/zvideo/skip/collection` | skipCollection | `d.ZP.skipCollection(i)` | home/static/js/async/53914.d64301c5.js:15445 |
| POST | `/zvideo/skip/task/info` | skipTaskInfo | `d.ZP.skipTaskInfo({classification_id:this.classification_id,collection_id:this.id})` | home/static/js/async/53914.d64301c5.js:15539 |
| POST | `/zvideo/skip/task/result` | skipTaskResult | `d.ZP.skipTaskResult({classification_id:this.classification_id,collection_id:e})` | home/static/js/async/53914.d64301c5.js:15634 |
| POST | `/zvideo/skip/task/action` | skipTaskAction | `d.ZP.skipTaskAction(a)` | home/static/js/async/53914.d64301c5.js:15731 |
| POST | `/zvideo/skip/task/edit` | skipTaskEdit | `d.ZP.skipTaskEdit(v)` | home/static/js/async/53914.d64301c5.js:15826 |
| POST | `/zvideo/skip/task/list` | skipTaskList | `d.ZP.skipTaskList(this.taskListParams)` | home/static/js/async/53914.d64301c5.js:15919 |
| POST | `/zvideo/share/v4/state` | shareClassAcceptOrReject | `n.ZP.shareClassAcceptOrReject({classification_id:[t.id],state:1==t.state?2:1})` | home/static/js/async/53914.d64301c5.js:16024 |
| POST | `/zvideo/classification/file/del` | classificationFileDel | `d.ZP.classificationFileDel({classification_id:t.classification_id,file_path:i})` | home/static/js/async/53914.d64301c5.js:16274 |
| POST | `/zvideo/collection/file/unmatch` | unMatchDir | `d.ZP.unMatchDir({classification_id:i.classification_id,file_path:i.file_path})` | home/static/js/async/53914.d64301c5.js:16374 |
| POST | `/zvideo/task/cron/set` | taskCronSet | `i.ZP.taskCronSet({enable:+!!s.enable,timer:s.timer})` | home/static/js/async/53914.d64301c5.js:16475 |
| POST | `/zvideo/task/cron/info` | taskCronInfo | `i.ZP.taskCronInfo({})` | home/static/js/async/53914.d64301c5.js:16567 |
| POST | `/zvideo/task/cron/result` | taskCronResult | `i.ZP.taskCronResult(s)` | home/static/js/async/53914.d64301c5.js:16662 |
| POST | `/zvideo/task/cron/video/remove` | taskCronVideoRemove | `i.ZP.taskCronVideoRemove({})` | home/static/js/async/53914.d64301c5.js:16764 |
| POST | `/zvideo/task/cron/video/retain` | taskCronVideoRetain | `i.ZP.taskCronVideoRetain({})` | home/static/js/async/53914.d64301c5.js:16872 |
| POST | `/zvideo/collection/video/version` | collectionVideoVersio | `s.ZP.collectionVideoVersio(o)` | home/static/js/async/53914.d64301c5.js:16982 |
| POST | `/zvideo/emby/user/info` | embyUserInfo | `d.ZP.embyUserInfo({})` | home/static/js/async/53914.d64301c5.js:17129 |
| POST | `/zvideo/emby/user/create` | embyUserCreate | `d.ZP.embyUserCreate({user_name:(0,_.fy)(t.mediaLibraryForm.user_name),password:e})` | home/static/js/async/53914.d64301c5.js:17268 |
| POST | `/zvideo/emby/user/status` | embyUserStatus | `d.ZP.embyUserStatus({status:+!!t})` | home/static/js/async/53914.d64301c5.js:17409 |
| POST | `/zvideo/rank/tmdb/collections` | rankTmdbCollections | `d.ZP.rankTmdbCollections({rank_type:1,page:1,page_size:1})` | home/static/js/async/53914.d64301c5.js:17511 |
| POST | `/zvideo/rank/tmdb/filters` | rankTmdbFilters | `r.ZP.rankTmdbFilters()` | home/static/js/async/53914.d64301c5.js:17614 |
| POST | `/transcode/thumb/exif` | m | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:313590 |
| GET | `/transcode/decrypt/playaddr` | getVideoPlayUrl | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:318693 |
| GET | `/transcode/playaddr` | getVideoPlayUrl | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:318723 |
| GET | `/transcode/decrypt/play` | getVideoPlayUrlV2 | `C.ZPm.getVideoPlayUrlV2({file_path:i.file_path,play_env:"local"==n?1:2,video_codec:o,audio_codec:a,encrypted_path:i.encrypted_path//void 0,audio_index:this.videoInfo.history.audio_index//0===this.videoInfo.history.audio_index?this.videoInfo.history.audio_index:void 0,subtitle_index:""!==this.videoInfo.history.subtitle_index&&+this.videoInfo.history.subtitle_index>=-1?this.videoInfo.history.subtitle_index:void 0,from:"zvideo"},l)` | home/static/js/index.3608137b.js:318907 |
| GET | `/transcode/play` | getVideoPlayUrlV2 | `C.ZPm.getVideoPlayUrlV2({file_path:i.file_path,play_env:"local"==n?1:2,video_codec:o,audio_codec:a,encrypted_path:i.encrypted_path//void 0,audio_index:this.videoInfo.history.audio_index//0===this.videoInfo.history.audio_index?this.videoInfo.history.audio_index:void 0,subtitle_index:""!==this.videoInfo.history.subtitle_index&&+this.videoInfo.history.subtitle_index>=-1?this.videoInfo.history.subtitle_index:void 0,from:"zvideo"},l)` | home/static/js/index.3608137b.js:318933 |
| GET | `/transcode/decrypt/subtitle` | getVideoSubtitle | `C.ZPm.getVideoSubtitle({file_path:this.videoInfo.is_share?"":i,specify_subtitles:JSON.stringify(e),encrypted_path:s//"",from:"zvideo"})` | home/static/js/index.3608137b.js:319038 |
| GET | `/transcode/subtitle` | getVideoSubtitle | `C.ZPm.getVideoSubtitle({file_path:this.videoInfo.is_share?"":i,specify_subtitles:JSON.stringify(e),encrypted_path:s//"",from:"zvideo"})` | home/static/js/index.3608137b.js:319068 |
| GET | `/transcode/decrypt/formatmenu` | getVideoFormatMenu | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:319191 |
| GET | `/transcode/formatmenu` | getVideoFormatMenu | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:319223 |
| GET | `/transcode/decrypt/format` | getVideoFormat | `h.ZPm.getVideoFormat({encrypted_path:this.encrypted_path//void 0,file_path:this.videoPath,play_env:"local"==X?1:2,dest_fmt:this.dest_fmt//void 0,video_codec:t,audio_codec:e})` | home/static/js/index.3608137b.js:319332 |
| GET | `/transcode/format` | getVideoFormat | `h.ZPm.getVideoFormat({encrypted_path:this.encrypted_path//void 0,file_path:this.videoPath,play_env:"local"==X?1:2,dest_fmt:this.dest_fmt//void 0,video_codec:t,audio_codec:e})` | home/static/js/index.3608137b.js:319360 |
| POST | `/transcode/decrypt/play/stop` | stopVideo | `M.ZPm.stopVideo({play_addr:t,isDecrypt:e})` | home/static/js/index.3608137b.js:319472 |
| POST | `/transcode/play/stop` | stopVideo | `M.ZPm.stopVideo({play_addr:t,isDecrypt:e})` | home/static/js/index.3608137b.js:319503 |
| POST | `/play/switchtrack` | switchtrack | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:319590 |
| POST | `/transcode/decrypt/play/switch` | switchtrackV2 | `h.ZPm.switchtrackV2({play_addr:this.playUrl,encrypted_path:this.encrypted_path//"",video_codec:d.join(","),audio_codec:this.$store.state.app.audioTypes,start_time:Math.floor(this.currentTime),audio_index:i,dest_fmt:s,subtitle_index:-2===o?"":o,from:this.fromApp})` | home/static/js/index.3608137b.js:319685 |
| POST | `/transcode/play/switch` | switchtrackV2 | `h.ZPm.switchtrackV2({play_addr:this.playUrl,encrypted_path:this.encrypted_path//"",video_codec:d.join(","),audio_codec:this.$store.state.app.audioTypes,start_time:Math.floor(this.currentTime),audio_index:i,dest_fmt:s,subtitle_index:-2===o?"":o,from:this.fromApp})` | home/static/js/index.3608137b.js:319718 |
| POST | `/transcode/mediainfo/exif` | postExif | `l.ZPm.postExif({file_path:n})` | home/static/js/index.3608137b.js:332355 |
| GET | `/transcode/decrypt/mediainfo/exif` | postDecryptExif, Y | `l.ZPm.postDecryptExif({encrypted_path:n,from:"pub_album"})` | home/static/js/index.3608137b.js:332456 |
| GET | `/transcode/setting/load` | A | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:352718 |
| POST | `/transcode/setting/set` | S | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:352801 |
| POST | `/transcode/traversal` | C | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:352882 |
| POST | `/transcode/video/process/tasks` | x | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:352961 |
| POST | `/transcode/video/process/delete` | D | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:353050 |
| POST | `/transcode/video/process/clear` | M | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:353140 |
| POST | `/transcode/clean/thumb` | I | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:353229 |
| GET | `/transcode/mediainfo/video` | U | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:354705 |
| GET | `/transcode/decrypt/mediainfo/video` | H, G | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:354791 |
| GET | `/transcode/mediainfo/image` | $ | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:354936 |
| GET | `/transcode/decrypt/mediainfo/image` | W | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:355058 |
| GET | `/transcode/mediainfo/exif` | V | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:355152 |
| POST | `/zvideo/share/collection/create` | ? | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:363785 |
| POST | `/transcode/video/process/add` | eO | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:371887 |
| POST | `/transcode/video/process/query` | eU | `未在当前脚本闭包中解析到调用；仅确认包装函数` | home/static/js/index.3608137b.js:371979 |

## 如何查完整参数

`nas-video-api-catalog.json` 保存每个接口的完整 request 对象、包装函数、已匹配调用的参数表达式、调用前后代码及所属 webpack module ID。`data:t` 仅表示原样转发，不表示接口没有参数。调用例中的 `t/e/n` 等是压缩变量；请结合保存的 context 和调用方法检查构造过程。自动匹配只解析明确的模块导入与静态导出成员，不声称已完成跨函数动态数据流。

下载范围包含三个目标页面路由的直接 chunk 和明确引用的后续懒加载 chunk；通用组件可能带入邻近功能的包装函数。清单中的“声明存在”和“当前收集到调用”分别记录；从未触发任何删除、清空、设置或登录请求。
