# Zspace installer: login/authentication and HTTP envelope

## Scope and result

Static-only analysis of extracted root `C:/Users/admin/AppData/Local/Temp/rea-extracted-efa92a55-ee86-432a-b294-5666b0b26c93`. Package metadata identifies `zspace` version `2.45.2026082601`, main `background.js`. No target JavaScript/native code was executed, no network requests were sent, no install/configuration changes were made, and no REA active-session operations were used. Node was used solely to read strings, enumerate literal declarations, and hash local files.

The login API module `c24f` contains **18 wrappers**, listed completely below. A supplementary literal URL scan covered all 10 first-party `static/js/*.js` bundles (excluding the vendor libraries and elementUI bundle); it found one additional auth-adjacent declaration, `POST /auth/master`, already in the shell module. This is complete for the literal wrappers in c24f, not proof that the NAS-delivered application or native SDK has no other authentication APIs. Dynamic URL construction and native internals remain unknown.

Main investigation supplied ASAR SHA-256 `4a8f9a8dd0d476d4ebffc62d02fdbb71da9401be9b1aab1a5cf2626ee09103a4`; this sub-investigation did not independently rehash the ASAR. Exact extracted-source hashes are recorded at the end. Future source snapshots can be matched to these hashes.

**Main result:** cloud key/discovery identifies a NAS, a native SDK provides the HTTP proxy address, then `/auth/login` receives independently RSA-encrypted username/password. Successful token state passes to the main process, which creates cookies and loads the NAS-served `/home/` through that proxy. The inspected request envelope contains no client-generated HMAC/request signature; `sign` is NAS response data forwarded to verification APIs and cookies. This is a source-level finding, not runtime confirmation.

## Endpoint inventory and exact parameters

All rows inherit the HTTP metadata/token/random-cache-buster behavior in the next section. “No explicit fields” means the caller passes no feature-specific fields; common envelope fields still apply. Cloud = `https://api.zenithspace.net`. NAS/base = mutable `store.state.nas.webBase`. Wrapper-level default timeout is 10 s except where stated. Each location points at the exact `url:` declaration.

| Method | Exact path | Destination selection | Feature parameters and observed response use | Definition evidence |
|---|---|---|---|---|
| GET | `/key/pub` | NAS/base or cloud | signme=1 (query). Cloud returns key,key_id; NAS returns key,sign,name. [F01,F02] | `static/js/chunk-84200ec6.b0586271.js@24860` |
| GET | `/zhelper/state` | NAS/base | No explicit fields in post-login call; response data.nasid. [F04] | `static/js/chunk-84200ec6.b0586271.js@25118` |
| POST | `/action/report/login` | NAS/base | Declared data:{}; 1 s timeout. Caller not established in selected login component. | `static/js/chunk-84200ec6.b0586271.js@25199` |
| POST | `/quick/nasid` | Cloud | username=RSA(cloud key,trim(username)), key_id. Observed response: nasid,username,phone,email. [F01,V09] | `static/js/chunk-84200ec6.b0586271.js@25364` |
| POST | `/auth/srepassword` | NAS/base | username=RSA(NAS key,username), password=RSA(NAS key,trim(newPassword)), sms_proof. [V08] | `static/js/chunk-84200ec6.b0586271.js@25472` |
| POST | `/auth/sexists` | NAS/base | username=RSA(NAS key,trim(username)), captcha_proof; response disable,repass,exists. [V06] | `static/js/chunk-84200ec6.b0586271.js@25556` |
| POST | `/captcha/check` | Cloud | captcha_id,captcha_code,append=username (plain); response captcha_proof. [V05] | `static/js/chunk-84200ec6.b0586271.js@25636` |
| POST | `/auth/login` | NAS/base | username=RSA(NAS key,trim(username)), password=RSA(NAS key,trim(password)); optional sms_proof. Email proof is also sent under sms_proof. [F03] | `static/js/chunk-84200ec6.b0586271.js@25801` |
| GET | `/captcha` | Cloud | No explicit fields in observed caller; response image,captcha_id,code_length,type. [V05] | `static/js/chunk-84200ec6.b0586271.js@25889` |
| POST | `/sms/usend` | Cloud | username=RSA(cloud key,trim(username)),key_id,nasid=NAS sign; optional type and by=voice. [V01] | `static/js/chunk-84200ec6.b0586271.js@25984` |
| POST | `/sms/ucheck` | Cloud | username=RSA(cloud key,trim(username)),key_id,nasid=NAS sign,sms_code=trim(code); response sms_proof. [V03] | `static/js/chunk-84200ec6.b0586271.js@26080` |
| GET | `/ql/code/gen` | Cloud | No explicit fields in observed calls; response bcode. [Q01] | `static/js/chunk-84200ec6.b0586271.js@26177` |
| POST | `/ql/code/read` | Cloud | bcode; response checked for nasid and qltk; repeats every 1 s until successful exchange or destruction. [Q02] | `static/js/chunk-84200ec6.b0586271.js@26276` |
| POST | `/account/loginbyqltk` | Inherited base; see QR caveat | qltk from code/read response; returns token and user metadata. No server apiTarget flag. [Q02] | `static/js/chunk-84200ec6.b0586271.js@26375` |
| POST | `/v2/email/send` | Cloud | email=RSA(cloud key,trim(email)),key_id,nasid=NAS sign; optional type and by. [V02] | `static/js/chunk-84200ec6.b0586271.js@26462` |
| POST | `/v2/email/check` | Cloud | username=RSA(cloud key,trim(username)),key_id,nasid=NAS sign,email_code=trim(code); response email_proof. [V04] | `static/js/chunk-84200ec6.b0586271.js@26562` |
| POST | `/reset/ok` | NAS/base | Observed explicit body {}; response data.reseting is checked against 1. [V07] | `static/js/chunk-84200ec6.b0586271.js@26663` |
| POST | `/auth/repassword` | NAS/base | username=RSA(NAS key,username),password=RSA(NAS key,trim(newPassword)),sms_proof. Requires reset/ok reseting=1 in this UI path. [V07] | `static/js/chunk-84200ec6.b0586271.js@26739` |

Additional login dependencies:

| Method | Exact path | Parameters / role | Evidence |
|---|---|---|---|
| POST | `/system/polling2` | No explicit argument in normal login's systemPoll call; standard envelope; 5 s timeout. Reads color/product after authentication. | [F04,F11,F12] |
| POST | `/auth/master` | checkedDev() passes no explicit fields; UI reads hostname,has. Adjacent device/migration check, not the credential login endpoint. | [F13,F14] |

`/action/report/login` has a wrapper but its invocation was not established in the selected component. A declaration does not establish a request was sent.

## HTTP envelope

The shell creates an Axios instance with `withCredentials:true`, timeout 10000 ms, separate HTTP/HTTPS keep-alive agents (keepAliveMsecs=1000,maxSockets=24,maxFreeSockets=8). Axios identity is corroborated by vendor module bc3a forwarding to cee4, which exposes Axios/create/CancelToken; an exact Axios version was not recovered. [H01,D01]

Base selection precedence is `config.baseUrl` override → `apiTarget:'server'` cloud host → `apiTarget:'direct'` empty prefix → current NAS webBase. It concatenates the selected prefix with config.url. The default state and login mount use `https://www.zconnect.cn`; ordinary credential login changes webBase to the SDK-returned HTTP address before fetching NAS key/authentication. [H03,F01,F02,F10]

Common fields are `plat='pc'`, `version`, `device_id`, `device`, `clientPublicIp`, captured into an object when the HTTP module initializes. appendParams adds missing fields only (undefined check); POST gets body fields, other methods get query params, and PUT skips appendParams. It does not automatically refresh that object on later state changes. [H02]

For POST **only when the caller has no explicit `Content-Type`**, the interceptor sets `application/x-www-form-urlencoded`, appends the current user token unless already supplied, and applies its serializer. Keys are unchanged; values use encodeURIComponent; arrays become repeated `name[]=value`; pairs join with `&`. An explicit Content-Type bypasses this token-injection/form-transform branch, but common metadata and drnd still apply. GET does not receive a token automatically from this branch. Cookies or explicit headers may carry authentication separately. [H04,H02]

`drnd` is `Date.now() + '_' + floor(10000*Math.random())`. POST appends it to URL as `?&drnd=...` if no query exists, otherwise `&drnd=...`; non-POST gets params.drnd. This is a random/time cache-buster, not an observed signature. [H04]

In the non-window context and outside development mode, the source sets Connection=keep-alive, Host=www.baidu.com, Referer=http://www.baidu.com, and a fixed zspace/3.1.7185 Chrome/89 Electron/12.2.3 User-Agent. Those are source literals, not evidence of installed runtime versions or a request to Baidu. A renderer with window.navigator skips this header rewrite. Configured system proxy host/port are assigned unless the composed URL contains `127.0.0.1`. The main-process bundle has a matching envelope around background.js@4544000. [H03]

The general shell API helper can supply an explicit Cookie header. Its cookie serializer maps nasid→nas_id and URL-encodes values except nas_id; its producer already URL-encodes token and device, so those two may be encoded twice. Fields: app=video, token, plat=pc, clientPublicIp, version, device_id, device, _l, nas_id=global.sessionStorage.clientNasId||'', uuid=global.sessionStorage.clientUUID||''. These are a helper's fields, not proof that every login call sends that explicit Cookie header. [H07]

## Cryptography and signing

Input helper ed08.g is **trim**, not hashing: `String(value).replace(/(^\s*)|(\s*$)/g,'')`. Credential login trims username/password, then encrypts each separately using NAS public key. There is no password MD5/SHA transformation in this observed call chain. [C01,F03]

Encryption helper g constructs JSEncrypt, sets the selected public key, and calls encrypt. With an explicit key unequal to its embedded fallback it encrypts the complete input in one operation. With the embedded fallback key it splits the JavaScript string into 50-character segments, encrypts each, and joins Base64 ciphertexts with `~`. Ordinary cloud and NAS login pass fetched keys explicitly; do not assume fallback segmentation is the normal path. [C02]

Bundled JSEncrypt identifies itself as `3.0.0-rc.1`. Its padding routine constructs `00 02 [nonzero random padding] 00 message`, i.e. RSAES-PKCS1-v1_5 encryption (inference directly from the implementation), and encrypt converts the RSA hex result to Base64. The 50-unit split is JavaScript substring length, not a UTF-8 byte-safe general segmentation rule. Cloud/NAS fetched key sizes and actual ciphertext values are unknown without responses; no key was fetched. [C03,C04,C05,C06]

`GET /key/pub?signme=1` supplies cloud `key,key_id` or NAS `key,sign,name`. Cloud username encryption uses key plus key_id to discover nasid. NAS sign is stored directly; SMS/email requests send `nasid: sign`, while the actual NAS identifier is separately stored under nasId/nas_id. Thus the verification API's **nasid parameter is the opaque signed NAS value**, not necessarily the discovered NAS ID. [F01,F02,V01,V02,V03,V04]

No invocation of JSEncrypt.sign, HMAC calculation, or canonical request-signing string was observed in these login/envelope paths. Bundled JSEncrypt having a generic sign method is not evidence the app uses it for requests. drnd and cookie st are timestamps/random data, not observed cryptographic signatures. The server's meaning/validation of sign, key rotation/expiry and proof replay protection are unknown.

The SDK service-configuration wrapper is separate from credential encryption. On Windows it loads `sdk/libzrpc_x64.dll` (ASAR path rewritten to app.asar.unpacked); macOS uses libzrpc.dylib. It derives key material by seeded J pseudo-random generation (seed 4728423, 64 generated integers concatenated), SHA-256 of that string, then uses first 32 hex-text characters as AES key and first 16 as IV. encodeService adds ts, JSON-stringifies the service configuration, applies AES-256-GCM, Base64-encodes update+final bytes and passes that string to libzrpc_start_service. The shown wrapper does not append getAuthTag output. This describes the JavaScript-to-DLL payload only; wire encryption, server handshake and DLL interpretation were not inspected. [S03,S04,S14,S15]

## Cloud versus LAN flow

Normal login validates a number-leading account, gets cloud key when needed, encrypts the username, calls `POST /quick/nasid`, and stores returned nasid/username. It synchronously sends MainThreadAction/simpleStartSerivce with nasId. SDK success supplies data.host/data.port; the renderer sets CookieRoot/webBase to `http://`+host and requests cookie writing. Next it gets NAS public key, encrypts the credentials, and calls /auth/login. Changing the username clears the NAS key/ID and stops the previous service. [F01,F02,F03]

IPv4/IPv6/local modes use deviceIp and selected remote port (default 5055). Port 5050 is labeled encrypted, sets the native private-network-access encryption flag, and requires a 13-word-character SN in the UI. The renderer passes localPort=13579, remotePort=selected port,nasId,ip,isV6 to simpleStartSerivce; the main wrapper configures private-network access with the selected remote port but starts a **service remote_port=5055**. Thus selected access port and proxied service port are distinct fields. The renderer still uses an HTTP URL to the returned local proxy; that does not prove the NAS leg is unencrypted. This path attempts cloud key retrieval too, but does not immediately abort when that cloud fetch fails; a fully offline success remains unverified. [F02,F09,S05,S13]

LAN discovery is renderer searchDevice IPC → main Ne.searchDevice → libzrpc_search_device → JSON-parsed result. The main IPC handler filters out nas_id starting with P0 and requires nas_id.substring(1,2)==='0'. UI uses nas_id/nas_ip. Selecting a device prepends http:// if needed, sets base/cookies, sets network=internal and retries validation. After login code N001413 it similarly searches for matching nas_id and retries against LAN IP. The discovery transport, UDP ports, broadcast packet format, server/P2P routing and cloud SDK host inventory remain inside native code and were not recovered. [F08,F07,S06,S07]

## Tokens, response handling, and web UI handoff

Successful Axios HTTP responses are judged by **application body code loosely equal to 200**, not solely HTTP status. Success adds success=true to the existing body. Other application codes return a resolved normalized object `{code,message,reason,success:false,data?}`; data is included only when truthy. Network errors are normalized similarly; 504 gives 请求超时, 500 gives 服务有些问题，请稍后重试。, Network Error becomes 网络连接错误. Errors are logged via main-process logging or MainThreadAction/NativeLog; this is not an exception-based business-error API. [H05,H06]

Credential success stores token,username,qcname,userinfo,avatar, then gets /zhelper/state to refine nasid, polls system state, adds history, stops the temporary service, and sends signin with the Vuex state. History receives token only when remember is true; it also stores mode, IP, port, TLS selection, NAS ID and user/device metadata. Clicking a saved history entry containing token restores state and goes directly to signin; that UI path contains no new /auth/login request. keepLogin and remember are saved as loginInfo fields. The renderer's persisted Vuex configuration uses encryptionKey:undefined; the observed store write path only encrypts when an encryption key is truthy. This does not prove every separate store/database is plaintext. [F04,F05,F06,F15,D02,D05]

Login UI maps these codes to actions (not universal backend definitions):

| Code | UI action |
|---|---|
| N001204 | Opens SMS verification dialog. |
| N001414 | Sets SMS type=new_device and shows new-device verification. |
| N001100 | Shows password reset in progress; asks user to finish in phone app. |
| N003553 | Restores cloud base and clears NAS ID/key/sign. |
| N001413 | Searches LAN for matching NAS ID and retries locally. |
| N150061 | Warns of final remaining password attempt for current IP. |

Evidence: [F07]. SMS/email check accepts input lengths 4 or 6, trims the code, stores returned proof and retries doValidate. Email verification yields email_proof but /auth/login sends it as **sms_proof**. Recovery similarly puts email_proof into its sms_proof variable before password-reset calls. Captcha/check sends append=username without RSA encryption; /auth/sexists checks disable/repass/exists. /auth/repassword first checks /reset/ok reseting=1 and shows the physical reset-button instruction if false. [V03,V04,V05,V06,V07,V08]

QR login gets bcode and renders `zspacebcode://bcode=<bcode>&version=v1`; code/read polls every 1000 ms. When nasid is present it stores it and exchanges qltk at /account/loginbyqltk, stores token/user metadata, then starts the proxy service, changes webBase, polls and sends signin. **Ordering caveat:** qltk exchange occurs before this component starts the NAS proxy. Its wrapper inherits current webBase (login mount initializes https://www.zconnect.cn); it is not explicitly sent to api.zenithspace.net. Do not silently label that request as going to the newly established local proxy. The UI text says local accounts do not support QR login. [Q01,Q02,Q03,F10]

Main signin copies credentials/state from renderer, invokes startWebProxy and opens the entry page. getEntry(true) returns `pe+'/home/'` only when connected and pe exists; otherwise it returns the local entry route. getEntry(false) returns local #/login. The main window calls X(e) to set cookies, then loadURL(e). WebProxyStarted assigns global.ApiHost from the SDK host and replaces https:// with http://. The ongoing web proxy starts near local port 13579 (13580 when 13579 is already MainProxyServicePort), remote service port 5055. [S08,S09,S10,S11,S12]

Cookie writer X sets zenithtoken and token to the same stored token, plus device_id,username,qcname,sign,nas_id,nasPubKey,isMaster,st=timestamp,_l=zh_cn and available deviceColor/devicePdt/deviceMode. Cookie values are encodeURIComponent encoded, path=/, expiration defaults to 365 days; domain is derived from the URL. The shown setter does not explicitly set HttpOnly/Secure/SameSite; actual Electron defaults and server cookie overwrites are unknown. app:// URLs are skipped. Cookie writing requests are not awaited to completion before navigation in the shown sequence. [S01,S02,S11]

Local index.html loads the shell bundles; /login lazy-loads the three named chunks. The authenticated /home/ is NAS-delivered web UI, so feature API callers can exist outside these shell resources. Preload provides IPC/global filesystem helpers and is attached to the main BrowserWindow; the checked custom preload section has no observed credential transformation or signing operation. Its globals and BrowserWindow preferences are static declarations, not confirmed runtime exposure. [D03,D04,P01,P02]

## Remaining unknowns and boundaries

No live response, request capture, real credential, token expiry/refresh, logout/revocation contract, MFA server enforcement, backend password verification, NAS web bundle or native DLL implementation was observed. The code scan found no additional literal auth/login-family URL wrappers outside c24f other than /auth/master, but does not rule out dynamic/native/NAS-delivered APIs. Errors/retries and request defaults described here are source paths, not evidence of successful runtime behavior.

The broader investigation's 极影视/recycle-bin API work is outside this subtask. This report establishes the login/proxy/cookie dependencies those NAS-delivered callers may need; it does not invent their API contracts from i18n strings or the shell's presence.

## Source evidence

Offsets are **zero-based JavaScript UTF-16 character indices** into the exact UTF-8-decoded, unformatted source; they are not UTF-8 byte offsets or line numbers. Relative paths are under the extraction root above. Each code block is an exact substring. For longer selected regions, two short fragments are displayed with independent exact offsets; omitted middle characters are not part of either block. Evidence IDs here are local report labels, not REA ledger IDs.
### H01

`static/js/app.2f202dac.js@33565` (end-exclusive 33755)

```javascript
h=s.a.create({withCredentials:!0,timeout:1e4,httpAgent:d,httpsAgent:p}),f=[function(e){let t=[];for(const o in e){let n=e[o];Array.isArray(n)?n.forEach(e=>{t.push(o+"[]="+encodeURIComponent(
```

### H02

`static/js/app.2f202dac.js@33818` (end-exclusive 34358)

```javascript
g={plat:"pc",version:r["a"].state.app.version,device_id:r["a"].state.app.deviceId,device:r["a"].state.app.device,clientPublicIp:r["a"].state.nas.clientPublicIp};h.appendParams=function(e,t){if("put"==e.method)return;let o;"post"==e.method?(e.data||(e.data={}),o=e.data):(e.params||(e.params={}),o=e.params);for(let n in t)void 0===o[n]&&(o[n]=t[n])},h.interceptors.request.use(e=>{let t=r["a"].state.nas.webBase;e.baseUrl?t=e.baseUrl:"server"==e.apiTarget?t="https://api.zenithspace.net":"direct"==e.apiTarget&&(t=""),!e.headers||"object"==
```

### H03

`static/js/app.2f202dac.js@34168` (end-exclusive 34718)

```javascript
h.interceptors.request.use(e=>{let t=r["a"].state.nas.webBase;e.baseUrl?t=e.baseUrl:"server"==e.apiTarget?t="https://api.zenithspace.net":"direct"==e.apiTarget&&(t=""),!e.headers||"object"==typeof window&&window.navigator||m||(e.headers["Connection"]="keep-alive",e.headers["Host"]="www.baidu.com",e.headers["Referer"]="http://www.baidu.com",e.headers["User-Agent"]=" Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) zspace/3.1.7185 Chrome/89.0.4389.128 Electron/12.2.3 Safari/537.36"),e.url=t+e.url,-1==e.url.indexOf(
```

Middle of selected region omitted.

`static/js/app.2f202dac.js@34908` (end-exclusive 35088)

```javascript
e"]||(e.headers["Content-Type"]="application/x-www-form-urlencoded",h.appendParams(e,{token:r["a"].state.user.token}),e.transformRequest=f);let o=(new Date).getTime()+"_"+Math.floo
```

### H04

`static/js/app.2f202dac.js@34868` (end-exclusive 35448)

```javascript
"post"!=e.method||e.headers["Content-Type"]||(e.headers["Content-Type"]="application/x-www-form-urlencoded",h.appendParams(e,{token:r["a"].state.user.token}),e.transformRequest=f);let o=(new Date).getTime()+"_"+Math.floor(1e4*Math.random());return"post"==e.method?(e.url.indexOf("?")<0&&(e.url+="?"),e.url+="&drnd="+o):(e.params||(e.params={}),e.params.drnd=o),e},e=>(console.log("request error",e),Promise.reject(e))),h.interceptors.response.use(e=>{const t=e.config.url;let o=e.data;return 200!=o.code?b(o.code,o.msg,o.data,t,o.reason||""):(o.success=!0,o)},e=>{let t="";e.reque
```

### H05

`static/js/app.2f202dac.js@35287` (end-exclusive 35977)

```javascript
h.interceptors.response.use(e=>{const t=e.config.url;let o=e.data;return 200!=o.code?b(o.code,o.msg,o.data,t,o.reason||""):(o.success=!0,o)},e=>{let t="";e.request&&e.request.responseURL?t=e.request.responseURL:e.config&&e.config.url&&(t=e.config.url),e.response&&(e=e.response);const o=e.data&&e.data.code||e.status;let n=e.data&&e.data.msg;return 504==o?n="请求超时":500==o&&(n="服务有些问题，请稍后重试。"),b(o||e.status||500,n||e.message,"",t)});const b=function(){var e=Object(n["a"])((function*(e,t){let o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null,n=arguments.length>3?arguments[3]:void 0,i=arguments.length>4&&void 0!==arguments[4]?arguments[4]:"",s="undefined"==typeof window;if(s)
```

### H06

`static/js/app.2f202dac.js@35726` (end-exclusive 36276)

```javascript
b=function(){var e=Object(n["a"])((function*(e,t){let o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null,n=arguments.length>3?arguments[3]:void 0,i=arguments.length>4&&void 0!==arguments[4]?arguments[4]:"",s="undefined"==typeof window;if(s)"N300477"!=e&&c.a.info({type:"AxiosError",code:e,error:t,url:n,globalApiHost:global.ApiHost});else{let o=window.top.require("electron"),i=o.ipcRenderer;i.send("MainThreadAction","NativeLog",{type:"AxiosError",code:e,error:t,url:n})}"Network Error"==t&&(t="网络连接错误");let r={code:e,message:t,reason:i,s
```

Middle of selected region omitted.

`static/js/app.2f202dac.js@36446` (end-exclusive 36626)

```javascript
isDark:!1,lastUserThemePath:""},i={SET_IS_DARK:(e,t)=>{e.isDark=t},SET_LAST_USER_THEME_PATH:(e,t)=>{e.lastUserThemePath=t}},s={setIsDark(e,t){let o=e.commit;o("SET_IS_DARK",t)},set
```

### H07

`static/js/app.2f202dac.js@28941` (end-exclusive 29516)

```javascript
const s=e=>{let t=[];for(let o in e){let n=e[o];"nasid"==o&&(o="nas_id"),"nas_id"==o?t.push(o+"="+n):t.push(o+"="+encodeURIComponent(n))}return t.join("; ")};function r(){return{app:"video",token:encodeURIComponent(i["a"].state.user.token),plat:"pc",clientPublicIp:i["a"].state.nas.clientPublicIp,version:i["a"].state.app.version,device_id:i["a"].state.app.deviceId,device:encodeURIComponent(i["a"].state.app.device),_l:i["a"].state.nas.locale,nas_id:global.sessionStorage.clientNasId||"",uuid:global.sessionStorage.clientUUID||""}}function a(e,t,o){let i=arguments.length>3&
```

### C01

`static/js/app.2f202dac.js@40069` (end-exclusive 40127)

```javascript
function s(e){return String(e).replace(/(^\s*)|(\s*$)/g,""
```

### C02

`static/js/chunk-3b0dd3ec.bee8efbf.js@42806` (end-exclusive 43356)

```javascript
const h="MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6\nHscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";function g(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:h,s=new d["JSEncrypt"];if(s.setPublicKey(t),t!=h)return s.encrypt(e);{let t=[];while(e){let i=e.substr(0,50);t.push(s.encrypt(i)),e=e.substr(50)}return t.join("~")}}var p=s("2f62"),v=s("fc14"),u=s("57aa"),m=s("f949"),f=s("8593"),b=s("2b0e"),y=function(){var e=this,t=e.$createElement,s=e._self._c||t;return s("Dialog",{attrs:{"append-
```

### C03

`static/js/chunk-3b397ee9.e0d36d38.js@41470` (end-exclusive 41950)

```javascript
function at(t,e){if(e<t.length+11)return console.error("Message too long for RSA"),null;var n=[],r=t.length-1;while(r>=0&&e>0){var i=t.charCodeAt(r--);i<128?n[--e]=i:i>127&&i<2048?(n[--e]=63&i|128,n[--e]=i>>6|192):(n[--e]=63&i|128,n[--e]=i>>6&63|128,n[--e]=i>>12|224)}n[--e]=0;var s=new ot,o=[];while(e>2){o[0]=0;while(0==o[0])s.nextBytes(o);n[--e]=o[0]}return n[--e]=2,n[--e]=0,new O(n)}var ut=function(){function t(){this.n=null,this.e=0,this.d=null,this.p=null,this.q=null,this
```

### C04

`static/js/chunk-3b397ee9.e0d36d38.js@65081` (end-exclusive 65166)

```javascript
t.prototype.encrypt=function(t){try{return f(this.getKey().encrypt(t))}catch(e){retur
```

### C05

`static/js/chunk-3b397ee9.e0d36d38.js@9757` (end-exclusive 10087)

```javascript
function f(t){var e,n,r="";for(e=0;e+3<=t.length;e+=3)n=parseInt(t.substring(e,e+3),16),r+=u.charAt(n>>6)+u.charAt(63&n);e+1==t.length?(n=parseInt(t.substring(e,e+1),16),r+=u.charAt(n<<2)):e+2==t.length&&(n=parseInt(t.substring(e,e+2),16),r+=u.charAt(n>>2)+u.charAt((3&n)<<4));while((3&r.length)>0)r+=c;return r}function l(t){var 
```

### C06

`static/js/chunk-3b397ee9.e0d36d38.js@65963` (end-exclusive 66008)

```javascript
t.version="3.0.0-rc.1",t}();window.JSEncrypt=
```

### F01

`static/js/chunk-3b0dd3ec.bee8efbf.js@101647` (end-exclusive 102197)

```javascript
"normal"==e.network&&!e.nasId){t=g(s,e.cloudPubKey);let i=yield Object(l["f"])(c["f"],[{username:t,key_id:e.cloudPubKeyId},ke],2);if(!i.success)return console.log("get nasId error"),void window.setTimeout(()=>{e.handleLostConnToServer(1)},100);{console.log("get nasId result:",i),e.$store.dispatch("nas/setNasId",i.data.nasid),e.$store.dispatch("user/setUserName",i.data.username),e.$ipc.send("clientDispatch",{key:"nas/setNasId",val:i.data.nasid}),e.$ipc.send("clientDispatch",{key:"user/setUserName",val:i.data.username});let t=e.$ipc.sendSync("Mai
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@102647` (end-exclusive 102827)

```javascript
oudPubKeyId){let t=yield Object(c["g"])("server");if(t.success){let s=t.data.key_id,i=t.data.key;e.$store.dispatch("nas/setPubKey",{cloudPubKey:i,cloudPubKeyId:s})}}let t=e.loginFo
```

### F02

`static/js/chunk-3b0dd3ec.bee8efbf.js@102812` (end-exclusive 103362)

```javascript
let t=e.loginForm.deviceIp;i=5050==e.ipPortValue,i?e.$store.dispatch("nas/setNasId",e.loginForm.nasId):e.$store.dispatch("nas/setNasId","");let s=e.$ipc.sendSync("MainThreadAction","simpleStartSerivce",{localPort:13579,remotePort:e.ipPortValue,nasId:e.nasId,ip:t,isV6:"ipv6"==e.loginMode});if(200!=s.code)return console.log("start service error",s),void(e.tips="无法连接到设备，请重试");console.log("start sservice for login:",s.data),e.CookieRoot="http://"+s.data.host,e.proxySdkPort=s.data.port,e.$store.dispatch("nas/setWebBase",e.CookieRoot),e.$ipc.send("wr
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@103672` (end-exclusive 103852)

```javascript
et s=t.data.key,i=t.data.sign,a=t.data.name;e.$store.dispatch("nas/setNasName",a),e.$store.dispatch("nas/setPubKey",{nasPubKey:s,sign:i})}}t=g(s,e.nasPubKey);let a,n=Object(l["g"])
```

### F03

`static/js/chunk-3b0dd3ec.bee8efbf.js@103811` (end-exclusive 104411)

```javascript
t=g(s,e.nasPubKey);let a,n=Object(l["g"])(e.loginForm.password);if(n=g(n,e.nasPubKey),console.log("call login:",{username:s,encodeName:t,password:n,sms_proof:e.sms_proof}),a=e.sms_proof?yield Object(c["k"])({username:t,password:n,sms_proof:e.sms_proof}):e.email_proof?yield Object(c["k"])({username:t,password:n,sms_proof:e.email_proof}):yield Object(c["k"])({username:t,password:n}),console.log("login res:",a),a.success){e.$store.dispatch("user/setToken",a.data.token),e.$store.dispatch("user/setUserName",a.data.username),e.$store.dispatch("user/setQcName",a.data.qcname),e.$store.dispatch("user/s
```

### F04

`static/js/chunk-3b0dd3ec.bee8efbf.js@104234` (end-exclusive 104764)

```javascript
e.$store.dispatch("user/setToken",a.data.token),e.$store.dispatch("user/setUserName",a.data.username),e.$store.dispatch("user/setQcName",a.data.qcname),e.$store.dispatch("user/setUserInfo",a.data),e.$store.dispatch("user/setAvatar",a.data.avatar),e.$stat.push({key:"login_complete",acode:e.$stat.ACODE.LOGIN,ap:"login",cur_url:"login"});let t=yield Object(c["i"])();if(200==t.code){let s=t.data.nasid;e.$store.dispatch("nas/setNasId",s),e.$ipc.send("clientDispatch",{key:"nas/setNasId",val:s})}else console.log("Get nasId error af
```

### F05

`static/js/chunk-3b0dd3ec.bee8efbf.js@105583` (end-exclusive 106323)

```javascript
token:e.loginForm.remember?a.data.token:"",nasId:e.nasId,color:e.color,deviceMode:e.deviceMode,nickname:a.data.nickname,tls:5050===e.ipPortValue,port:e.ipPortValue,nasName:e.nasName,avatar:"",is_local:a.data.is_local};if(a.data.avatar){const t=e.CookieRoot+a.data.avatar;s.avatar=yield e.cacheAvatarToLocal(t,a.data.username,e.nasId)}e.$ipc.send("clientDispatch",{key:"user/addHistoryUser",val:s}),e.$ipc.sendSync("MainThreadAction","stopService"),e.$ipc.send("signin",e.$store.state)}));return function(e){return t.apply(this,arguments)}}())}else if(e.noticeVisible=!0,e.loginLoading=!1,e.tips=a.message||"连接超时，请稍后重试",e.tipsCode=a.code||"",e.smsVerifySuccess&&(e.loginWithSmsError=!0),"N001204"==a.code)e.messageDialogVisible=!0,e.smsCheck
```

### F06

`static/js/chunk-3b0dd3ec.bee8efbf.js@90075` (end-exclusive 90605)

```javascript
onClickUser(e){console.log(e),e.token?(this.$store.dispatch("nas/setNasId",e.nasId),this.$store.dispatch("user/setUserName",e.username),this.$store.dispatch("user/setQcName",e.qcname),this.$store.dispatch("user/setMaster",e.isMaster),this.$store.dispatch("user/setToken",e.token),this.$store.dispatch("nas/setDevColor",e.color),this.$store.dispatch("nas/setDevModel",e.deviceMode),this.$store.dispatch("nas/setNasName",e.nasName),this.$store.dispatch("user/setLoginInfo",{remember:!0}),this.$store.dispatch("nas/setPubKey",{nasPub
```

### F07

`static/js/chunk-3b0dd3ec.bee8efbf.js@106269` (end-exclusive 106819)

```javascript
"N001204"==a.code)e.messageDialogVisible=!0,e.smsCheckType="";else if("N001100"==a.code)e.tips="密码重置中，请用手机APP完成密码重置";else if("N003553"==a.code)e.network="normal",e.CookieRoot="https://www.zconnect.cn",e.$store.dispatch("nas/setWebBase",e.CookieRoot),e.$store.dispatch("nas/setNasId",""),e.$store.dispatch("nas/setPubKey",{nasPubKey:"",sign:""});else if("N001414"==a.code)e.smsCheckType="new_device",e.newDeviceCheck=!0;else if("N001413"==a.code){e.loginLoading=!0,e.findDevices();for(let t=0;t<e.localDevices.length;t++){let s=e.localDevices[t];if(s.
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@107689` (end-exclusive 107869)

```javascript
bject(l["c"])(e.nas_id,"line","a1","l")}),this.searchDevStatus="showList"):this.searchDevStatus="notFound"},selectDevice(e){this.$store.dispatch("nas/setNasId",e.nas_id);let t=e.na
```

### F08

`static/js/chunk-3b0dd3ec.bee8efbf.js@107464` (end-exclusive 108014)

```javascript
findDevices(){this.deviceListOffsetLeft=0;let e=this.$ipc.sendSync("searchDevice");e&&Array.isArray(e.data)?this.localDevices=e.data:this.localDevices=[],this.localDevices.length>0?(this.localDevices.forEach(e=>{e.deviceImg=Object(l["c"])(e.nas_id,"line","a1","l")}),this.searchDevStatus="showList"):this.searchDevStatus="notFound"},selectDevice(e){this.$store.dispatch("nas/setNasId",e.nas_id);let t=e.nas_ip;"http"!=t.substr(0,4)&&(t="http://"+t),this.CookieRoot=t,this.$store.dispatch("nas/setWebBase",this.CookieRoot),this.$ipc.send("writeCookies
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@108244` (end-exclusive 108424)

```javascript
se();let i="notice"+s.replace(s[0],s[0].toUpperCase());this.$message({message:t,type:s,duration:5e3,showClose:!0,customClass:i+" noticeMsg"})},getHistoryInfo(){let e=this.$ipc.send
```

### F09

`static/js/chunk-3b0dd3ec.bee8efbf.js@89325` (end-exclusive 89675)

```javascript
portRefValueChange(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:5055;this.$nextTick(()=>{if(!this.$refs.portSelectRef)return;const t=this.$refs.portSelectRef.$el||null;if(t){let s=t.getElementsByTagName("input");s.length&&(s=s[0]);const i={5055:"5055 [非加密]",5050:"5050 [加密]"};s.value=i[e]}})},dropVisibleChange(){this.userListVisibl
```

### F10

`static/js/chunk-3b0dd3ec.bee8efbf.js@112779` (end-exclusive 113279)

```javascript
this.CookieRoot="https://www.zconnect.cn",this.$store.dispatch("nas/setWebBase",this.CookieRoot),this.$store.dispatch("nas/setNasId",""),this.$store.dispatch("user/setUserName",""),this.$store.dispatch("user/setQcName",""),this.$store.dispatch("user/setToken",""),this.$ipc.send("clientDispatch",{key:"nas/setNasId",val:""}),this.$ipc.send("writeCookiesToClient",this.CookieRoot),this.$stat.push({key:"page_view",acode:this.$stat.ACODE.PAGE_VIEW,ap:"login",cur_url:"/login"}),this.getHistoryInfo(),th
```

### V01

`static/js/chunk-3b0dd3ec.bee8efbf.js@48491` (end-exclusive 48641)

```javascript
o={username:a,key_id:t.cloudPubKeyId,nasid:t.sign};t.type&&(o.type=t.type),s&&(o.by=s);let n=yield Object(c["p"])(o);return n.success||200==n.code?(o.
```

### V02

`static/js/chunk-3b0dd3ec.bee8efbf.js@51384` (end-exclusive 51539)

```javascript
o={email:a,key_id:t.cloudPubKeyId,nasid:t.sign};t.type&&(o.type=t.type),s&&(o.by=s);let n=yield Object(c["q"])(o);return!(!n.success&&200!=n.code)||(t.$emi
```

### V03

`static/js/chunk-3b0dd3ec.bee8efbf.js@72748` (end-exclusive 73448)

```javascript
checksms(){var e=this;return Object(o["a"])((function*(){if(e.errorMsg="",4!=e.smsCode.length&&6!=e.smsCode.length)return void(e.errorMsg="验证码有误");e.button_loading=!0;let t=Object(l["g"])(e.username),s=g(t,e.cloudPubKey),i=yield Object(c["r"])({username:s,key_id:e.cloudPubKeyId,nasid:e.sign,sms_code:e.smsCode});i.success?(e.show="reset",e.strengthLength=0,e.sms_proof=i.data.sms_proof,e.button_loading=!1):(e.errorMsg=i.message,e.button_loading=!1)}))()},checkemail(){var e=this;return Object(o["a"])((function*(){if(e.errorMsg="",4!=e.smsCode.length&&6!=e.smsCode.length)return void(e.errorMsg="验证码有误");e.button_loading=!0;let t=Object(l["g"])(e.username),s=g(t,e.cloudPubKey),i=yield Object(c["b"
```

### V04

`static/js/chunk-3b0dd3ec.bee8efbf.js@73205` (end-exclusive 73945)

```javascript
checkemail(){var e=this;return Object(o["a"])((function*(){if(e.errorMsg="",4!=e.smsCode.length&&6!=e.smsCode.length)return void(e.errorMsg="验证码有误");e.button_loading=!0;let t=Object(l["g"])(e.username),s=g(t,e.cloudPubKey),i=yield Object(c["b"])({username:s,key_id:e.cloudPubKeyId,nasid:e.sign,email_code:e.smsCode});i.success?(e.show="reset",e.strengthLength=0,e.sms_proof=i.data.email_proof):e.errorMsg=i.message,e.button_loading=!1}))()},getCaptcha(){Object(c["j"])().then(e=>{e.success&&(this.captchaImg=e.data.image,this.captcha_id=e.data.captcha_id,this.code_length=e.data.code_length,this.imgType=e.data.type)})},checkCaptcha(){this.button_loading=!0,Object(c["c"])({captcha_id:this.captcha_id,captcha_code:this.code,append:this.user
```

### V05

`static/js/chunk-3b0dd3ec.bee8efbf.js@73646` (end-exclusive 74326)

```javascript
getCaptcha(){Object(c["j"])().then(e=>{e.success&&(this.captchaImg=e.data.image,this.captcha_id=e.data.captcha_id,this.code_length=e.data.code_length,this.imgType=e.data.type)})},checkCaptcha(){this.button_loading=!0,Object(c["c"])({captcha_id:this.captcha_id,captcha_code:this.code,append:this.username}).then(e=>{e.success?(this.captcha_proof=e.data.captcha_proof,this.checkUsername()):(this.errorMsg=e.message,this.getCaptcha(),this.button_loading=!1)})},checkUsername(){if(0==this.username.length)return void(this.errorMsg="请输入账号");if(this.username.length<11)return void(this.errorMsg="当前用户不存在，请重新输入");this.button_loading=!0;let e=Object(l["g"])(this.username);Object(c["d"])(
```

### V06

`static/js/chunk-3b0dd3ec.bee8efbf.js@74311` (end-exclusive 74761)

```javascript
Object(c["d"])({username:g(e,this.nasPubKey),captcha_proof:this.captcha_proof}).then(e=>{e.success?0==e.data.disable&&1==e.data.repass&&1==e.data.exists?this.show="verifyMethod":(this.errorMsg="连接极空间异常，请重试或检查设备。",this.getCaptcha()):(this.errorMsg=e.message,this.getCaptcha()),this.button_loading=!1})},getNasIdFunc(){var e=arguments,t=this;return Object(o["a"])((function*(){let s=!(e.length>0&&void 0!==e[0])||e[0],i=Object(l["g"])(t.username),a=g(i
```

### V07

`static/js/chunk-3b0dd3ec.bee8efbf.js@68038` (end-exclusive 68688)

```javascript
let s=Object(l["g"])(t.newPassword);s=g(s,t.nasPubKey),t.button_loading=!0,t.errorMsg="",t.errorMsg="";let i=yield Object(c["n"])({});return i.success?1!=i.data.reseting?(t.errorMsg="请长按reset键4秒，电源灯慢闪后再进行重置。",void(t.button_loading=!1)):(t.errorMsg="",void Object(c["a"])({username:g(t.username,t.nasPubKey),password:s,sms_proof:t.sms_proof}).then(e=>{if(t.button_loading=!1,e.success)return t.$message({message:"重置密码成功",type:"success",customClass:"messageSuccess"}),t.beforeClose(),t.$store.dispatch("user/setToken",e.data.token),t.$store.dispatch("user/setUserName",e.data.username),t.$store.dispatch("user/setQcName",e.data.qc_name),t.$store.dispat
```

### V08

`static/js/chunk-3b0dd3ec.bee8efbf.js@71265` (end-exclusive 71565)

```javascript
let e=Object(l["g"])(this.newPassword);e=g(e,this.nasPubKey),this.button_loading=!0,Object(c["o"])({username:g(this.username,this.nasPubKey),password:e,sms_proof:this.sms_proof}).then(e=>{if(this.button_loading=!1,!e.success)return this.errorMsg=e.message,void this.$message({message:e.message,type:"
```

### V09

`static/js/chunk-3b0dd3ec.bee8efbf.js@74613` (end-exclusive 75163)

```javascript
getNasIdFunc(){var e=arguments,t=this;return Object(o["a"])((function*(){let s=!(e.length>0&&void 0!==e[0])||e[0],i=Object(l["g"])(t.username),a=g(i,t.cloudPubKey),o=yield Object(c["f"])({username:a,key_id:t.cloudPubKeyId});if(o.success){t.recoveryPhone=o.data.phone||"",t.recoveryEmail=o.data.email||"",t.$store.dispatch("nas/setNasId",o.data.nasid),t.$store.dispatch("user/setUserName",o.data.username),t.$ipc.send("clientDispatch",{key:"nas/setNasId",val:o.data.nasid}),t.$ipc.send("clientDispatch",{key:"user/setUserName",val:o.data.username}),co
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@75333` (end-exclusive 75513)

```javascript
ata.name;t.$store.dispatch("nas/setNasName",a),t.$store.dispatch("nas/setPubKey",{nasPubKey:s,sign:i})}s&&t.checkCaptcha()}}))()}},mounted(){var e=this;return Object(o["a"])((funct
```

### Q01

`static/js/chunk-3b0dd3ec.bee8efbf.js@77535` (end-exclusive 77815)

```javascript
const t=yield Object(c["e"])(),s=t.success,i=t.data;s&&(e.bcode=i.bcode,pe.a.toCanvas(e.$refs.qrcode,`zspacebcode://bcode=${i.bcode}&version=v1`,me,t=>{if(t)return console.error(t);e.loopReadQrcode()}))}))()},refreshQrcode(){var e=this;return Object(o["a"])((function*(){const t=y
```

### Q02

`static/js/chunk-3b0dd3ec.bee8efbf.js@78030` (end-exclusive 78580)

```javascript
loopReadQrcode(){var e=this;clearTimeout(this.timer),this.timer=setTimeout(Object(o["a"])((function*(){const t=yield Object(c["h"])({bcode:e.bcode}),s=t.success,i=t.data;if(s&&i.nasid){e.$store.dispatch("nas/setNasId",i.nasid),e.$ipc.send("clientDispatch",{key:"nas/setNasId",val:i.nasid});const t=yield Object(c["l"])({qltk:i.qltk}),s=t.success,a=t.data;if(s){e.$store.dispatch("user/setToken",a.token),e.$store.dispatch("user/setUserName",a.username),e.$store.dispatch("user/setQcName",a.qcname),e.$store.dispatch("user/setUserInfo",a),e.$store.dis
```

Middle of selected region omitted.

`static/js/chunk-3b0dd3ec.bee8efbf.js@79600` (end-exclusive 79780)

```javascript
ct.getOwnPropertySymbols(e);t&&(i=i.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),s.push.apply(s,i)}return s}function Ce(e){for(var t=1;t<arguments
```

### S01

`background.js@4557465` (end-exclusive 4558065)

```javascript
const $=(e,t,n="",o=365)=>{let r=(e=>{let t=e.replace(/\w*:\/\//,"");if(t=t.split("/")[0],t=t.replace(/:\d+/,""),/(\d+\.){3}\d+/.test(t))return t;if("localhost"==t)return t;{const e=t.split(".");return e.length>2?`.${e[e.length-2]}.${e[e.length-1]}`:"."+t}})(e);const s={url:e,name:t,value:encodeURIComponent(n),path:"/",domain:r};o&&(s.expirationDate=Math.round((new Date).getTime()/1e3)+24*o*3600),i.session.defaultSession.cookies.set(s,e=>{e&&console.error("set cookie error",e)})};var X=async e=>{e.startsWith("app")||($(e,"zenithtoken",a.a.state.user.token),$(e,"token",a.a.state.user.token),$(e
```

### S02

`background.js@4557950` (end-exclusive 4558500)

```javascript
var X=async e=>{e.startsWith("app")||($(e,"zenithtoken",a.a.state.user.token),$(e,"token",a.a.state.user.token),$(e,"device_id",a.a.state.app.deviceId),$(e,"username",a.a.state.user.username),$(e,"qcname",a.a.state.user.qcname),$(e,"sign",a.a.state.nas.sign),$(e,"nas_id",a.a.state.nas.nasId),$(e,"nasPubKey",a.a.state.nas.nasPubKey),""!=a.a.state.nas.color&&$(e,"deviceColor",a.a.state.nas.color),""!=a.a.state.nas.devicePdt&&$(e,"devicePdt",a.a.state.nas.devicePdt),""!=a.a.state.nas.deviceMode&&$(e,"deviceMode",a.a.state.nas.deviceMode),$(e,"isMa
```

Middle of selected region omitted.

`background.js@4558840` (end-exclusive 4559020)

```javascript
0,this.mti=1;this.mti<this.N;this.mti++)e=this.mt[this.mti-1]^this.mt[this.mti-1]>>>30,this.mt[this.mti]=(1812433253*((4294901760&e)>>>16)<<16)+1812433253*(65535&e)+this.mti,this.m
```

### S03

`background.js@4560594` (end-exclusive 4561134)

```javascript
ue="darwin"==process.platform?"libzrpc.dylib":"libzrpc_x64.dll",le=oe.join(__dirname,"sdk",ue);le=le.replace("app.asar","app.asar.unpacked");let de,he,pe="",fe="",me="";(()=>{let e=4728423,t="",n=new J(e);for(let o=0;o<64;o++)e=n.genrand_int32(),t+=e;let o=ee.a.createHash("sha256").update(t).digest("hex");de=o.substring(0,32),he=o.substring(0,16)})(),global._proxyDll?ce=global._proxyDll:(ce=new ne.Library(le,{libzrpc_init:["int",["string"]],libzrpc_uninit:["void",[]],libzrpc_refresh:["bool",[]],libzrpc_check_ports:["string",["string"]
```

### S04

`background.js@4561800` (end-exclusive 4562145)

```javascript
ce.encodeService=e=>{e.ts=(new Date).getTime();let t=JSON.stringify(e);const n=ee.a.createCipheriv("aes-256-gcm",de,he);let o=n.update(t,"utf8");o=se.concat([o,n.final()]);const r=o.toString("base64");return ce.libzrpc_start_service(r)},global._proxyDll=ce);const _e=e=>e?JSON.parse(e):{code:500,msg:"调用SDK方法时发生错误"},ge=()=>{if(global.proxySdkHas
```

### S05

`background.js@4566211` (end-exclusive 4566641)

```javascript
simpleStartSerivce:(e,t,n,o="",i=!1)=>{ge(),ce.libzrpc_stop_all_service(),o?ve(o,t,i,5050==t):ve("");let s={local_port:e,remote_port:5055,type:1,nas_id:n||o};r.a.info("simpleStartSerivce: ",{localPort:e,remotePort:t,nasId:n,ip:o,isV6:i}),r.a.info("serviceConf: ",s);let a=_e(ce.encodeService(s));return r.a.info("simpleStartSerivce result: ",a),a},stopService:()=>{pe="",me="",Ie=!1,global.apiSuccessTime=0,Ae&&(clearInterval(Ae),
```

### S06

`background.js@4566829` (end-exclusive 4566924)

```javascript
searchDevice:()=>(ge(),_e(ce.libzrpc_search_device())),diagnose:()=>{ge();let e=a.a.state.nas.n
```

### S07

`background.js@4913974` (end-exclusive 4914224)

```javascript
i.ipcMain.on("searchDevice",e=>{let t=Ne.searchDevice();r.a.info("ipcMain search devices:",t),Array.isArray(t.data)&&(t.data=t.data.filter(e=>!e.nas_id.startsWith("P0")&&"0"==e.nas_id.substring(1,2))),e.returnValue=t}),i.ipcMain.on("upgrade",(e,t,n)=
```

### S08

`background.js@4567062` (end-exclusive 4567612)

```javascript
startWebProxy:()=>{ge();let e=13579;if(13579==global.MainProxyServicePort&&e++,r.a.info("startWebProxy",{localPort:e,proxyHost:pe}),!pe){if(global.apiSuccessTime=0,Ie=!1,a.a.state.app.develpmentMode)return pe=a.a.state.app.develpmentBase,Ae||(Ae=setInterval(Ce,3e3)),Ce(),void process.emit("WebProxyStarted");let t=a.a.state.user.loginInfo,n=a.a.state.nas.nasId,o=n;if("normal"!=t.loginMode&&""!=t.deviceIp){let e="ipv6"==t.loginMode,n=5050==t.loginPort,i=ve(t.deviceIp,t.loginPort,e,n);if(r.a.info(`setPrivateNetworkAccess ${t.deviceIp} ${t.loginPor
```

Middle of selected region omitted.

`background.js@4568082` (end-exclusive 4568262)

```javascript
ncConfig.remoteApiPort=h.data.port,a.a.dispatch("app/setLocalPort",h.data.port)),process.emit("WebProxyStarted"),Ae||(Ae=setInterval(Ce,3e3)),Ce(),!global.isRelease&&n){let e=_e(ce
```

### S09

`background.js@4568428` (end-exclusive 4568593)

```javascript
getEntry:e=>{let t=Ee();return e?t.connected&&pe?pe+"/home/":"app://./index.html#/entry":"app://./index.html#/login"},getStatus:Ee,setPrivateNetworkAccess:ve,checkNa
```

### S10

`background.js@4914677` (end-exclusive 4915227)

```javascript
i.ipcMain.on("signin",(e,t,n=!0)=>{if(!n&&t.user.username!=a.a.state.user.username)return void r.a.info(`!!! username has changed from ${a.a.state.user.username} to ${t.user.username} `);let o=(new Date).getTime();(e=>{a.a.dispatch("user/setUserName",e.user.username),a.a.dispatch("user/setQcName",e.user.qcname),a.a.dispatch("user/setMaster",e.user.isMaster),a.a.dispatch("user/setToken",e.user.token),a.a.dispatch("user/setAvatar",e.user.avatar),a.a.dispatch("nas/setNasIp",e.nas.nasIp),a.a.dispatch("nas/setDevColor",e.nas.color),a.a.dispatch("nas
```

Middle of selected region omitted.

`background.js@4915967` (end-exclusive 4916147)

```javascript
),il()):r.a.info("Open page for user: "+t.user.username)});let Rl=async e=>{r.a.info("ipcMain event: switchToUser, isSwitchingUser:"+ju,e.username),ju||(ju=!0,global.webClientVersi
```

### S11

`background.js@4876767` (end-exclusive 4877317)

```javascript
function il(){rl=""!=a.a.state.user.token;let e=Ne.getEntry(rl);r.a.info({hasLogin:rl,entryUrl:e});try{((e,t)=>{if(!e)return;const n=B(t);e.hide(),e.setResizable(!0),e.setMaximizable(!0),e.setMinimumSize(n.minWidth,n.minHeight),e.setFullScreen(n.fullscreen),e.setPosition(Math.ceil(n.left),Math.ceil(n.top),!0),e.setSize(Math.ceil(n.width),Math.ceil(n.height)),e.show(),process.nextTick(()=>{})})(Yu,rl)}catch(e){r.a.info("resize entry error",e)}r.a.info("openEntryPage resized"),X(e),r.a.info("openEntryPage: writeCookiesToClient"),Object(Cc.setTime
```

Middle of selected region omitted.

`background.js@4877737` (end-exclusive 4877917)

```javascript
test(n))}function cl(e,t){return`${e||"renderer"}:${t||"unknown"}`}function ul(e,t){if(!e)return null;const n=`${String(e.id)}:${t||"main_window"}`;return ol[n]||(ol[n]={attempts:[
```

### S12

`background.js@4892754` (end-exclusive 4892934)

```javascript
process.on("WebProxyStarted",async()=>{r.a.info("WebProxyStarted"),global.ApiHost=Ne.getHost(),global.ApiHost=global.ApiHost.replace("https://","http://"),r.a.info("create tray:"+!
```

### S13

`background.js@4563205` (end-exclusive 4563360)

```javascript
ve=(e,t=5055,n=!1,o=!1)=>(r.a.info("Connect by IP: "+e),ce.libzrpc_set_private_network_access(e,t,n,o)),be=e=>(r.a.info("set IPv6 Priority"+e),ce.libzrpc_s
```

### S14

`background.js@4560985` (end-exclusive 4561535)

```javascript
ce=new ne.Library(le,{libzrpc_init:["int",["string"]],libzrpc_uninit:["void",[]],libzrpc_refresh:["bool",[]],libzrpc_check_ports:["string",["string"]],libzrpc_start_service:["string",["string"]],libzrpc_stop_service:["void",["string"]],libzrpc_stop_all_service:["void",[]],libzrpc_network_diagnose:["string",["string"]],libzrpc_link_diagnose:["string",["string"]],libzrpc_get_nas_status:["string",[]],libzrpc_search_device:["string",[]],libzrpc_set_device_type:["void",["string"]],libzrpc_set_private_network_access:["int",["string","int","bool","boo
```

Middle of selected region omitted.

`background.js@4561645` (end-exclusive 4561825)

```javascript
conn_ability:["string",["string","int"]],libzrpc_get_force_tunnel:["bool",[]],libzrpc_set_force_tunnel:["void",["bool"]]}),console.log("load dll success"),ce.encodeService=e=>{e.ts
```

### S15

`background.js@4560769` (end-exclusive 4561109)

```javascript
let e=4728423,t="",n=new J(e);for(let o=0;o<64;o++)e=n.genrand_int32(),t+=e;let o=ee.a.createHash("sha256").update(t).digest("hex");de=o.substring(0,32),he=o.substring(0,16)})(),global._proxyDll?ce=global._proxyDll:(ce=new ne.Library(le,{libzrpc_init:["int",["string"]],libzrpc_uninit:["void",[]],libzrpc_refresh:["bool",[]],libzrpc_check_p
```

### P01

`preload.js@42024` (end-exclusive 42174)

```javascript
global.sendIpcMsg=(t,e)=>{c.send(t,e)},global.onIpcMsg=(t,e)=>{c.on(t,e)},global.db=t=>{const e=new u(o.join((t=>o.join(c.sendSync("getSystemPath","ap
```

### P02

`background.js@4885685` (end-exclusive 4885835)

```javascript
preload:U.a.join(__dirname,"preload.js")},acceptFirstMouse:!0,maximizable:!0,resizable:!0,minWidth:t.minWidth,minHeight:t.minHeight,fullscreen:t.fulls
```

### D01

`static/js/chunk-libs.0f791608.js@350446` (end-exclusive 350921)

```javascript
cee4:function(e,t,n){"use strict";var r=n("c532"),o=n("1d2b"),i=n("0a06"),a=n("4a7b"),s=n("2444");function c(e){var t=new i(e),n=o(i.prototype.request,t);return r.extend(n,i.prototype,t),r.extend(n,t),n}var u=c(s);u.Axios=i,u.create=function(e){return c(a(u.defaults,e))},u.Cancel=n("7a77"),u.CancelToken=n("8df4"),u.isCancel=n("2e67"),u.all=function(e){return Promise.all(e)},u.spread=n("0df6"),e.exports=u,e.exports.default=u},d354:function(e,t,n){"use strict";var r=n("c59
```

### D02

`static/js/app.2f202dac.js@6809` (end-exclusive 6904)

```javascript
name:"vuex",encryptionKey:void 0})})]});break}catch(p){if(m>=2)throw new Error("初始化配置文件失败，请关闭程序
```

### D03

`static/js/app.2f202dac.js@21451` (end-exclusive 21666)

```javascript
{path:"/login",name:"login",component:()=>Promise.all([o.e("chunk-3b397ee9"),o.e("chunk-84200ec6"),o.e("chunk-3b0dd3ec")]).then(o.bind(null,"9ed6"))},{path:"/zstatus",name:"zstatus",component:()=>o.e("chunk-5ae07b76
```

### D04

`index.html@4324` (end-exclusive 4576)

```javascript
<script type=module src=app://./static/js/chunk-elementUI.e2434d5e.js></script><script type=module src=app://./static/js/chunk-libs.0f791608.js></script><script type=module src=app://./static/js/app.2f202dac.js></script><script>!function(){var e=docume
```

### F11

`static/js/app.2f202dac.js@28587` (end-exclusive 28697)

```javascript
systemPoll:I,format:P,home:O,checkedSN:y,checkedDev:w,checkDisk:_,checkUsername:E,askState:v,startChangeDev:S,
```

### F12

`static/js/app.2f202dac.js@32153` (end-exclusive 32283)

```javascript
function I(e){return Object(n["a"])({url:"/system/polling2",method:"post",data:e,timeout:5e3})}function P(e){let t={url:"/disk/for
```

### F13

`static/js/chunk-3b0dd3ec.bee8efbf.js@94640` (end-exclusive 94970)

```javascript
f["a"].checkedDev().then(t=>{e.newDeviceDialogVisible&&(t.success?(e.devName=t.data.hostname,e.showWhich="canChange",1==t.data.has?e.devHas=1:e.devHas=0):e.changeErrorMsg="获取新设备信息失败")}))})),50)):this.changeErrorMsg="无法连接到此极空间设备"}else this.changeErrorMsg=t.message})},reConnect(){this.startChange()},startChange(){this.$root.$emit(
```

### F14

`static/js/app.2f202dac.js@31409` (end-exclusive 31509)

```javascript
function w(e){return Object(n["a"])({url:"/auth/master",method:"post",data:e})}function S(e){return 
```

### F15

`static/js/chunk-3b0dd3ec.bee8efbf.js@92565` (end-exclusive 93055)

```javascript
saveUserCheck(){let e={loginMode:this.loginMode,remember:this.loginForm.remember,keepLogin:this.loginForm.keepLogin,loginPort:this.ipPortValue||5055};this.$store.dispatch("user/setLoginInfo",e),this.$ipc.send("clientDispatch",{key:"user/setLoginInfo",val:e})},getUpgradeLicenseCheck(){var e=this;return Object(o["a"])((function*(){let t=yield f["a"].getUpgradeLicenseCheck(),s=!1;return"200"==t.code?1==t.data.has_agreed_license?s=!0:e.dialog_upgradeLicenseAgree.visible=!0:404==t.code?s=!0
```

### D05

`static/js/app.2f202dac.js@28010` (end-exclusive 28425)

```javascript
set store(e){p.sync(a.dirname(this.path));let t=JSON.stringify(e,null,"\t");if(this.encryptionKey){const e=c.randomBytes(16),o=c.scryptSync(this.encryptionKey,"salt",32),n=c.createCipheriv("aes-256-cbc",o,e),i=Buffer.concat([n.update(Buffer.from(t)),n.final()]);t=Buffer.concat([e,i])}w(this.path,t),this.events.emit("change")}*[Symbol.iterator](){const e=this.store;for(const t of Object.keys(e))yield[t,e[t]]}}}).
```

### Q03

`static/js/chunk-3b0dd3ec.bee8efbf.js@42423` (end-exclusive 42458)

```javascript
本地账号暂不支持扫码登录")])}],o=(s("28a5"),s("
```

### API wrapper declaration excerpts

`static/js/chunk-84200ec6.b0586271.js@24860`

```javascript
url:"/key/pub",method:"get",apiTarget:t,params:{signme:1},timeout:e};return"nas"==t&&(i.httpAgent=new n.Agent({keepAlive:!1}),"object"==typeof window&&window.navigator||(
```

`static/js/chunk-84200ec6.b0586271.js@25118`

```javascript
url:"/zhelper/state",method:"get",params:t})
```

`static/js/chunk-84200ec6.b0586271.js@25199`

```javascript
url:"/action/report/login",method:"post",data:{},timeout:1e3})
```

`static/js/chunk-84200ec6.b0586271.js@25364`

```javascript
url:"/quick/nasid",method:"post",apiTarget:"server",data:t,timeout:e})
```

`static/js/chunk-84200ec6.b0586271.js@25472`

```javascript
url:"/auth/srepassword",method:"post",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@25556`

```javascript
url:"/auth/sexists",method:"post",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@25636`

```javascript
url:"/captcha/check",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@25801`

```javascript
url:"/auth/login",method:"post",data:t,timeout:e})
```

`static/js/chunk-84200ec6.b0586271.js@25889`

```javascript
url:"/captcha",method:"get",apiTarget:"server",params:t})
```

`static/js/chunk-84200ec6.b0586271.js@25984`

```javascript
url:"/sms/usend",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26080`

```javascript
url:"/sms/ucheck",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26177`

```javascript
url:"/ql/code/gen",method:"get",apiTarget:"server",params:t})
```

`static/js/chunk-84200ec6.b0586271.js@26276`

```javascript
url:"/ql/code/read",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26375`

```javascript
url:"/account/loginbyqltk",method:"post",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26462`

```javascript
url:"/v2/email/send",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26562`

```javascript
url:"/v2/email/check",method:"post",apiTarget:"server",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26663`

```javascript
url:"/reset/ok",method:"post",data:t})
```

`static/js/chunk-84200ec6.b0586271.js@26739`

```javascript
url:"/auth/repassword",method:"post",data:t})
```

## Source identity (SHA-256 over original bytes)

| Relative file | SHA-256 |
|---|---|
| `static/js/app.2f202dac.js` | `b92e6fcd8c8ef069e6a7cb5432f8e330fc83a71399d814e290b085b2fde8dee2` |
| `static/js/chunk-3b0dd3ec.bee8efbf.js` | `b35f3f33a8b91d0012447f32724e280b3ca130a68f4844d69b7c1d91f56a1253` |
| `static/js/chunk-84200ec6.b0586271.js` | `f6746e83773475272598cca495ab9f0a1c871ea4e498edf4a43bd902425d0f6b` |
| `static/js/chunk-3b397ee9.e0d36d38.js` | `f43092c98d0b14a6000c51246280667a26a627cf722a1e2a4d466c988d07c524` |
| `background.js` | `224b2622f0384fa5606189e68b15f66c9c6bc5c43b86ba1666db617c3e5302fe` |
| `preload.js` | `4d6ae34952c9bbedc5406e33a892c419901ca635366b93265fe80cec455eb08b` |
| `index.html` | `f7da03dd03caeb673248fdc22e74563d660d8e23c2d320feb76d318c2e355637` |
| `package.json` | `9677f1104c86474d8f66b8d29f6bfb6243138a36d46253e5f5454651dc1f624d` |
| `static/js/chunk-libs.0f791608.js` | `08d0db50071e6e3a4102d90e6d7c81e1fc0a5c8abe69486cb9b8bb7eba994dae` |

