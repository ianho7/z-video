# Zconnect web login/authentication and HTTP envelope

## Result and evidence boundary

The acquired public web frontend is sufficient to recover the browser-side login contract without authenticating. It differs materially from the installer shell: browser login resolves a server cluster, carries `plat=web`, conditionally injects form `token/nasid`, stores browser cookies, and can transfer login state to a LAN origin through bridge/entry pages. It does not require the desktop native proxy DLL in the ordinary browser path.

Only static local files were read. No target JavaScript was evaluated, no login was attempted, no network request was sent by this sub-investigation, and no REA session or main acquisition script was changed. Findings are source observations or explicitly labeled inferences, never runtime confirmation. The installer report remains `outputs/login-analysis.md`.

Source page supplied by the user: [Zconnect home](https://zconnect.cn/home/). Main acquisition recorded provenance in `outputs/web-source-manifest.json` and snapshots in `outputs/web-source-snapshot`. This investigation read the local mirror under `work/zconnect-web`; all **25 inspected files** matched the manifest's byte SHA-256 values. Exact URLs and hashes for those files appear below. Download time is acquisition metadata, not backend/API version proof.

`outputs/web-login-api-catalog.json` preserves **40 scoped endpoint/variant entries**, feature parameter locations, definitions, verified source call text where available, branch classification and source identity. Account CRUD outside authentication and video/recycle APIs are excluded. Multiple entries for /v2/ud/key/pub represent different URL/base-selection variants, not an accidental duplicate endpoint count. The catalog is bounded to login/authentication, not all product API reachability.

## Default route and normal cloud login

Module 55202 maps /login components to async chunks. The supplied build's module 78296 exports Tj=false, so the /login route selects `./index` (module 18020, chunks 62035/30475/2601/62931); `./abroad` remains an alternative branch in the acquired code. OAuth, QR, LAN detection, entry and shared verification components also have explicit context mappings. Static chunk references are not proof of successful loading. [R01,R02,R03]

Network classification is based on location.host: a dashed-IPv4-style hostname is local; a host including zconnect.cn is cloud; otherwise local. This is a browser UI heuristic, not a discovered packet-routing property. [F08]

For ordinary cloud credential login the source performs these stages:

1. Clear clusterHost; trim username; get cloud public key/key_id if missing; POST /quick/nasid with RSA(cloud key,username) and key_id. Store returned NAS/account metadata. [F01]
2. GET `https://proxy.zenithspace.net/tracker/query?platform=nas&zrp=v2`, with **HTTP header id=nasid**. Response local_addrs is split on semicolons into candidate LAN addresses. [F01,H08]
3. GET `https://zrpl-ucloud.zenithspace.net/v2/getcluster?action=login`, also with **HTTP header id=nasid**. Response data becomes clusterHost. Cache fallback is localStorage.clusters[MD5(nasid).substring(0,8)]. These id values are NOT query parameters: rawAjax's fourth argument is headers, while its third argument is params/body. [F01,H08,C06]
4. GET /key/pub on the cluster/current origin to obtain NAS key,sign,name. Trim password, encrypt username/password separately using the NAS key, then POST /auth/login. Optional email_proof is deliberately sent under the field **sms_proof**, as is SMS proof. [F01,F02]
5. Store token and user metadata, POST /system/polling2, then navigate to the requested from route or /home/. If cloud mode has LAN addresses, try LAN handoff first. The same frontend contains an Electron IPC branch, but the plain browser branch uses location navigation. [F03,F06]

The local-account path skips the awaited cloud NAS-discovery stage and authenticates against the current origin. If cloud key material is available and the account is not classified local, a non-awaited cloud lookup can still populate metadata. This is not a guarantee of offline success. [F01]

## Browser HTTP request contract

The shared helper is webpack module **89904** in `home/static/js/index.a785a6de.js`. It creates Axios with timeout=30000 ms and withCredentials=false. A NAS request with a selected clusterHost gets prefix https://clusterHost and withCredentials=true; ordinary same-origin requests use an empty prefix. apiTarget=server chooses https://api.zenithspace.net; share chooses https://znas.cn; direct uses no prefix. The interceptor deletes apiTarget. URL prefixing has feature-specific exclusions for downloader/transfer/play paths; they do not change the inspected auth paths. Browser withCredentials=false does not mean same-origin cookies are disabled. [H01,H03]

**Critical guard:** appendParams only runs when config.data is an object and method is not PUT. It writes missing keys only; POST goes to data, other methods to params. Therefore a normal GET /key/pub with undefined data still receives its explicit signme=1 plus rnd/webagent, but does **not** automatically acquire the common metadata. Likewise a no-argument POST helper whose data remains undefined must not be described as automatically receiving body metadata/token. This differs from the desktop helper. [H02]

When eligible, common fields are plat=web, version, device_id, device and _l. The source reads current store values on each interceptor invocation. /docker/api, forRemoteNas and requestAsJson skip common metadata injection. An ordinary POST with no explicit Content-Type sets application/x-www-form-urlencoded, conditionally appends token and **nasid** using the same object-data guard, then serializes. Explicit Content-Type bypasses this form/token branch. requestAsJson uses JSON.stringify; that flag does not itself set a Content-Type in this code. Form values use encodeURIComponent and array values repeat key[]=value. [H01,H02,H03,H04]

All requests record metadata.startTime. POST adds `?&rnd=<timestamp>_<random0..9999>&webagent=v2` when no query already exists, or appends those fields to an existing query. Non-POST sets params.rnd only if neither a truthy params.rnd nor an existing URL rnd= is present; params.webagent=v2 is assigned. These are cache/version markers, not an observed signature. [H05]

Remote-NAS wrappers are distinct: GET /zconn/http/5055/{nasid}/key/pub and POST /zconn/http/5055/{nasid}/auth/login. The latter sets forRemoteNas=true and explicit headers **rtoken,rdeviceid,rdevice,ruser** from the remote credential object. forRemoteNas suppresses automatic metadata and body token/nasid injection; form serialization and rnd/webagent still apply. These wrappers are declared in the source; a default-login route call to them was not established here. [H09; catalog dynamic entries]

The interceptor has a separate Docker-only Authorization header assignment, not a global NAS Bearer-token header. The inspected normal login path has no desktop-style Host/Referer/User-Agent rewrite and no universal computed X-signature/HMAC header. HTTP id on tracker/cluster requests and rtoken-family headers on remote-NAS requests must not be merged into an invented single auth header scheme. [H03,H04,H08,H09]

## RSA, signing, identifiers and regional encryption

The trim helper is String(value).replace(/(^\s*)|(\s*$)/g,""). Passwords are trimmed then RSA-encrypted; no password MD5/SHA transformation is present in the ordinary login chain. MD5 in this path is for cache keys/device ID generation, not password verification. [C02,F02,C05,C06]

RSA helper 73920.Fd uses bundled JSEncrypt. With a fetched key unequal to its embedded fallback it encrypts the whole value once; fallback mode splits JavaScript strings into 50-unit substrings and joins encrypted segments with ~. Vendor module 12122's padding has 00 02, random nonzero bytes, 00, plaintext, identifying RSAES-PKCS1-v1_5 encryption (implementation-based inference), followed by Base64 output. No exact JSEncrypt release/version is asserted. [C01,C03,C04]

Cloud /key/pub returns key/key_id; NAS /key/pub returns key/sign/name. sign is stored directly from the NAS. SMS/email verification uses `nasid: remoteSign || sign`; that is an opaque NAS-provided value, distinct from the discovered NAS ID in the normal body nasid field/cookie nas_id. No generic client HMAC or RSA signature computation was observed in the normal login/envelope. Merely bundling JSEncrypt.sign does not prove its use. Server verification/rotation/expiry semantics are unknown. [V01,V02,F01,F02,S06]

Device ID helper persists an MD5 of a generated UUID-like string in localStorage[xnas-device]. Cluster-cache keys use the first 8 MD5 hex characters of nasid. The original generated strings, fetched keys and real tokens were not obtained. [C05,C06,F01]

The alternative regional branch has a second agreement protocol (module 35869), separate from ordinary password RSA. It declares GET /v2/ud/key/pub and POST /v2/ud/agree,/expire,/check against **VUE_APP_ZLINK_BASE_API**, whose final configured host is not resolved here. updateAgreeKey generates uuid, hashes uuid+Math.random()+time with SHA-256 to hex h, RSA-encrypts h to rid, and submits {uuid,rid,key_id}. It interleaves character bytes of h with bytes decoded from response rid, hashes the mixed buffer with SHA-256, and takes 32 bytes as AES key/16 as IV. AES-256-CBC decrypts response agree_info and encrypts NAS identifiers/payloads. Global agreement writes encoded nas_id and uuid cookies; expiration comes from decoded agree_info. This is an RSA/derived-AES exchange in source, not evidence of ECDH or a universal HTTP signature. [A04,A05,A06]

QcInfo/QcShare local caches use another helper: a fixed seeded pseudo-random derivation (seed floor(100000*pi)) → SHA-256 → AES-256-GCM, IV=first 12 digest bytes, with the 16-byte auth tag prepended to ciphertext before Base64. That cache wrapper is separate from CBC request/identifier encryption. Its encode/decode implementations are present, but no server round trip was tested. The supplied default Tj=false build does not establish that these regional flows are active on zconnect.cn. [A07,R02]

## Browser session and token behavior

Initial user state reads zenithtoken, falling back to token; string `0` is treated as empty. SET_TOKEN writes zenithtoken in an ordinary browser and token when the User-Agent matches Electron plus zspace/UnifyDrive. NAS ID normally lives in cookie nas_id. Cloud key/key_id receive explicit 30-day cookie lifetimes; NAS key/sign cookie writes are conditional in the NAS mutation and should not be assumed for every environment. [S01,S03,S06]

Cookie helper uses path=/ and adds domain=.zconnect.cn when the current host includes zconnect.cn. If localStorage.keepLogin is exactly `true` and no lifetime was specified, it sets expires=360 days; otherwise these ordinary helper writes have no explicit expires. It does not explicitly add Secure/HttpOnly/SameSite in the shown configuration. Server Set-Cookie behavior and browser defaults were not observed. Remember username and keepLogin are separate localStorage flags; the remembered value is username, not the typed password. [S02,F05]

At top-level application startup, existing token is submitted to POST /auth/token with {token:this.token}; successful response updates user, authorize, permissions, avatar and storage permissions. The caller does not replace token from a new response token. This is evidence of session/user validation/restoration, **not confirmed token refresh**. [S04]

POST /auth/pwdcheck receives RSA(NAS key,username) and RSA(NAS key,trim(password)) for password re-verification. A scoped admin verification caller uses POST /auth/tmptoken with current token and RSA-encrypted password; it only consumes success before continuing its callback. The name tmptoken alone does not establish returned-token or refresh behavior. [T01,T02]

When keepLogin is explicitly false, the top-window non-Electron route guard compares cookie st to current time. A gap over 90000 ms clears both token cookies/store token; otherwise it refreshes st and maintains a 1-second timestamp timer. This is client route-guard/heartbeat logic, not a proven backend token TTL. [S05]

The login component clears several auth/identity cookies on mount (unless from=preview), including nas_id,token,zenithtoken,nasPubKey,cloudPubKey/key_id,username,sign,st and metadata. It does not invoke a recovered logout API in this sequence. No server-side revocation contract is claimed. [F07]

## Response normalization, MFA, OAuth and QR

Success includes body code loosely equal to 200 or string S000200; success=true is added. A final responseURL ending 504.html is normalized as a NAS connection failure. Blob/octet-stream bodies are wrapped from HTTP status; additional non-auth adapters exist but are outside this report. Failure returns a resolved {code,message,reason,success:false,data?}, so callers generally inspect success rather than relying on Promise rejection. [H06,H07,H10]

For non-/zconn/ errors N001207,N001208,N001100,N001413,N001001,N001209 with a nonzero auth cookie, the global response handler compares cookie token with store token: mismatch reloads the top page; match emits signout (N001413 can first display a notice). These are UI actions, not a complete backend error taxonomy. The normal login component opens SMS for N001204, new-device verification for N001414, shows reset-in-progress for N001100, offers IP login for N001413, warns at N150061, and resets the SMS-success flag at N001415. [H07,F04]

SMS/email send/check and password-recovery contracts are tabulated below. SMS/email code validation in selected dialogs accepts length 4 or 6; the regional cloud-identity code flow expects six digits. Captcha/check carries plain append=username, followed by /auth/sexists using encrypted username and captcha_proof. /auth/repassword checks /reset/ok reseting=1; /auth/srepassword submits username/password/sms_proof directly after recovery proof. The same field sms_proof can carry email proof. [E01,E02,E03,E04,V01,V02; catalog call evidence]

/oauthLogin requires os,source,redirectUrl query values. After the same NAS RSA credential login, POST /auth/oauth2/authorize receives {os,source,redirectUrl}. A successful response's access_token and expires_in are appended as token/expires_in URL query parameters to decodeURIComponent(redirectUrl), then location.href changes. Neither OAuth token validity nor a redirect allowlist was verified. [O01,O02]

QR flow calls GET /ql/code/gen, renders zspacebcode://bcode=<bcode>&version=v1, polls POST /ql/code/read with bcode every second, and exchanges response qltk via POST /account/loginbyqltk. The exchange inherits current origin/cluster; it is not explicitly a server-target API. After token state is stored, cloud mode queries tracker/LAN info and NAS key/system state before choosing a handoff path. The QR path does not show the same pre-exchange getcluster sequence as password login. [Q01,Q02]

## LAN bridge and entry-token handoff

The modern LAN detector queries tracker and builds HTTPS iframes of the form `https://<dashed-ip>.<normalized-nas-name>.direct.zspace.link:5056/<base>/bridge.html?t=<time>` (direct.ud.link for its alternative branch). On load it postMessages token,username,qcname,device_id,device,nas_id,cloud and NAS keys,plat,version and model/color data to that iframe. This is source data flow, not evidence those URLs resolved or received a token. [L02]

It listens for an xnas-ok message, parses readPubKey/token/device_id, and requires readPubKey to match current NAS public key. If cookies already match, it navigates to the responding origin's app base; otherwise it builds `/login/entry?tk=...&color=...&pdt=...`. tk is fallback-RSA encryption of JSON [token,deviceId,nasId,Date.now(),isMaster]. The helper contains an embedded matching private-key/default decrypt path; this is client-side token packaging, not an observed server signature or fresh credential challenge. No private-key string is reproduced here. [L01,C01,C07]

LoginEntry decrypts tk, requires at least 3 array items, then compares embedded time against current time with a 90000 ms absolute difference bound. If within range, it stores user token,NAS ID and device ID, then navigates to /home/; if stale, /home/login. Actual server-side acceptance is unobserved. Fallback after the LAN detector timeout returns to https://clusterHost-or-current-host/<base>/. [L03,L04]

For NAS pcversion values whose final 10-digit segment has a date before **20260327**, the source selects an older HTTP /login/jump path instead of modern /login/lanDetect. The older jump page builds http://LAN:5055/<base>/bridge.html iframes, with the same credential metadata/message and entry-tk concept. That jump page reports login unless SkipLoginReport=1. [F06,L05,L06]

## Endpoint/variant catalog

Parameter rows are feature-level fields only; apply module 89904's conditional envelope above. “branch” classifies source code, not runtime reachability. Full structured records and static call references are in `outputs/web-login-api-catalog.json`.

| Method | Path/template | Branch | Target/base rule | Feature fields | Definition (UTF-16 offset) |
|---|---|---|---|---|---|
| POST | `/action/report/login` | handoff | cluster/current origin | body:  | `home/static/js/index.a785a6de.js@390616` |
| GET | `/key/pub` | default-login | apiTarget argument; server=https://api.zenithspace.net, nas=cluster/current origin | query: signme=1 | `home/static/js/index.a785a6de.js@390835` |
| POST | `/quick/nasid` | default-login | https://api.zenithspace.net | body: username=RSA(cloud public key,trim(username)); key_id=cloudPubKeyId | `home/static/js/index.a785a6de.js@391599` |
| POST | `/auth/login` | default-login | https://clusterHost if selected, else current origin | body: username=RSA(NAS public key,trim(username)); password=RSA(NAS public key,trim(password)); sms_proof=optional SMS proof OR email_proof under this same field | `home/static/js/index.a785a6de.js@391932` |
| POST | `/auth/pwdcheck` | reauthentication | cluster/current origin | body: username=RSA(NAS key,username); password=RSA(NAS key,trim(password)) | `home/static/js/index.a785a6de.js@392002` |
| POST | `/sms/usend` | verification | https://api.zenithspace.net | body: username=RSA(cloud key,trim(username)); key_id=cloudPubKeyId; nasid=remoteSign \|\| NAS sign; type=optional; by=optional voice | `home/static/js/index.a785a6de.js@392237` |
| POST | `/sms/ucheck` | verification | https://api.zenithspace.net | body: username=RSA(cloud key,trim(username)); key_id=cloudPubKeyId; nasid=NAS sign; sms_code=code | `home/static/js/index.a785a6de.js@392412` |
| POST | `/v2/email/send` | verification | https://api.zenithspace.net | body: email=RSA(cloud key,trim(email)); key_id=cloudPubKeyId; nasid=remoteSign \|\| NAS sign; type=optional; by=optional | `home/static/js/index.a785a6de.js@392501` |
| POST | `/v2/email/check` | verification | https://api.zenithspace.net | body: username=RSA(cloud key,trim(username)); key_id=cloudPubKeyId; nasid=NAS sign; email_code=code | `home/static/js/index.a785a6de.js@392687` |
| POST | `/auth/tmptoken` | reauthentication | cluster/current origin | body: token=current token; password=RSA(NAS key,trim(password)) | `home/static/js/index.a785a6de.js@393184` |
| POST | `/auth/token` | session-restore | cluster/current origin | body: token=existing user token | `home/static/js/index.a785a6de.js@393331` |
| GET | `/captcha` | recovery | https://api.zenithspace.net | query:  | `home/static/js/index.a785a6de.js@393401` |
| POST | `/captcha/check` | recovery | https://api.zenithspace.net | body: captcha_id=captcha identifier; captcha_code=entered code; append=plain username | `home/static/js/index.a785a6de.js@393488` |
| POST | `/auth/sexists` | recovery | cluster/current origin | body: username=RSA(NAS key,trim(username)); captcha_proof=captcha proof | `home/static/js/index.a785a6de.js@393682` |
| POST | `/auth/srepassword` | recovery | cluster/current origin | body: username=RSA(NAS key,username); password=RSA(NAS key,trim(newPassword)); sms_proof=proof | `home/static/js/index.a785a6de.js@393754` |
| POST | `/auth/authcode` | declaration-only | cluster/current origin | Not resolved | `home/static/js/index.a785a6de.js@393976` |
| POST | `/v2/vcode/send/by/email` | alternative-region | https://api.zenithspace.net | body: key_id=cloudPubKeyId; email=RSA(cloud key,email); uuid=random UUID; captcha_code=entered captcha; check=isCheck / 1 | `home/static/js/index.a785a6de.js@394682` |
| POST | `/v2/vcode/login` | alternative-region | https://api.zenithspace.net | body: email=RSA(cloud key,email); vcode=six-digit code; device=client device | `home/static/js/index.a785a6de.js@394783` |
| POST | `/v2/qc/list` | alternative-region | https://api.zenithspace.net | body: token=cloudToken, overrides standard body user token | `home/static/js/index.a785a6de.js@394876` |
| POST | `/auth/qcv` | alternative-region | cluster/current origin | body: no explicit argument in observed call; not an explicit {} payload | `home/static/js/index.a785a6de.js@394965` |
| POST | `/v2/qc/create/master` | alternative-region | https://api.zenithspace.net | body: email=RSA(cloud key,email); qcv=qcv; vcode=code; _lc=username; _se=sendEmail | `home/static/js/index.a785a6de.js@395033` |
| GET | `/ql/code/gen` | qr-login | https://api.zenithspace.net | query:  | `home/static/js/index.a785a6de.js@395625` |
| POST | `/ql/code/read` | qr-login | https://api.zenithspace.net | body: bcode=generated QR code | `home/static/js/index.a785a6de.js@395717` |
| POST | `/account/loginbyqltk` | qr-login | cluster/current origin; not explicit server target | body: qltk=from code/read | `home/static/js/index.a785a6de.js@395809` |
| POST | `/reset/ok` | recovery | cluster/current origin | body:  | `home/static/js/index.a785a6de.js@395984` |
| POST | `/auth/repassword` | recovery | cluster/current origin | body: username=RSA(NAS key,username); password=RSA(NAS key,trim(newPassword)); sms_proof=proof, possibly empty/undefined in physical-reset path | `home/static/js/index.a785a6de.js@396053` |
| POST | `/auth/regist` | alternative-region | cluster/current origin | body: username=RSA(NAS key,username); password=RSA(NAS key,password) | `home/static/js/index.a785a6de.js@396236` |
| POST | `/auth/oauth2/authorize` | oauth-login | cluster/current origin | body: os=oauthParams.os; source=oauthParams.source; redirectUrl=oauthParams.redirectUrl | `home/static/js/index.a785a6de.js@379982` |
| GET | `/zconn/http/5055/{nasid}/key/pub` | remote-NAS-wrapper | cluster/current origin | path: nasid=t / query: signme=1 | `home/static/js/index.a785a6de.js@391243` |
| POST | `/zconn/http/5055/{nasid}/auth/login` | remote-NAS-wrapper | cluster/current origin | path: nasid=t / body: e (caller-provided, not resolved in selected login route) / headers: rtoken=s.token; rdeviceid=s.device_id; rdevice=s.device; ruser=s.username | `home/static/js/index.a785a6de.js@391492` |
| GET | `/v2/captcha/{uuid}` | alternative-region | https://api.zenithspace.net | path: uuid=random UUID / query:  | `home/static/js/index.a785a6de.js@393576` |
| GET | `/v2/ud/key/pub` | alternative-region | apiTarget argument; path is /v2/ud/key/pub only when Tj=true; supplied build Tj=false chooses /key/pub | query: signme=1 | `home/static/js/index.a785a6de.js@391057` |
| GET | `/v2/ud/key/pub` | alternative-region-agreement | VUE_APP_ZLINK_BASE_API + path; configured host unresolved | query:  | `home/static/js/index.a785a6de.js@1383331` |
| POST | `/v2/ud/agree` | alternative-region-agreement | VUE_APP_ZLINK_BASE_API + path; configured host unresolved | body: uuid=random UUID; rid=RSA(qc public key,SHA256(uuid+random+timestamp) hex); key_id=qcPubKeyId | `home/static/js/index.a785a6de.js@1383417` |
| POST | `/v2/ud/expire` | alternative-region-agreement | VUE_APP_ZLINK_BASE_API + path; configured host unresolved | body: nasid=NAS sign; uuid=agreement uuid; expire=AES-CBC duration string | `home/static/js/index.a785a6de.js@1383509` |
| POST | `/v2/ud/check` | alternative-region-agreement | VUE_APP_ZLINK_BASE_API + path; configured host unresolved | body: plain=plaintext; cipher=AES-CBC ciphertext; uuid=agreement uuid | `home/static/js/index.a785a6de.js@1383602` |
| GET | `/tracker/query` | default-cloud-login | https://proxy.zenithspace.net | query: platform=nas; zrp=v2 / headers: id=discovered nasid | `home/static/js/async/62931.614afdfb.js@43864` |
| GET | `/v2/getcluster` | default-cloud-login | https://zrpl-ucloud.zenithspace.net | query: action=login / headers: id=discovered nasid | `home/static/js/async/62931.614afdfb.js@44194` |
| POST | `/system/polling2` | default-login | cluster/current origin | body: undefined in observed no-argument login systemPoll() call; do not assume {} | `home/static/js/index.a785a6de.js@364300` |
| GET | `/zhelper/state` | session-restore | cluster/current origin | Not resolved | `home/static/js/index.a785a6de.js@351685` |

## Limits

No request/response capture, login, backend implementation, actual token, server RSA key, token expiry, Cookie response, CORS policy, cluster availability, bridge behavior, or regional configured API host was confirmed at runtime. Generic source wrappers do not prove invocation. The shared wrapper index contains account/video/other utilities; only scoped auth entries were carried forward. The two originally unresolved context chunk filenames (35735/90002) do not imply their module implementations were absent: relevant 35790/57361 module bodies also exist in fetched shared chunks. Runtime lazy loading remains unverified.

The report preserves install-time findings and does not redefine desktop crypto/SDK behavior from browser code. It makes no new claim about video/recycle endpoint semantics.

## NAS-source comparison (bounded follow-up, 2026-10-16)

This addendum compares the supplied NAS capture at `http://192.168.5.2:5055/home/` with the cloud baseline above. Main investigation identified the NAS address as 192.168.5.2; this worker did not perform DNS or network probes. The NAS entry is `home/static/js/index.3608137b.js`, with app version **2.3.2026082801** at character 1306047; cloud entry declares **2.3.2026042401** at character 1267808. These are source version literals, not live backend/version confirmation. [N01]

All 9 read NAS files matched `outputs/nas-source-manifest.json`; snapshots are under `outputs/nas-source-snapshot`. No target execution, login or new acquisition was performed. The existing 40 cloud catalog entries each have a `nasSource` definition/pattern reference; one additional NAS-only declaration makes **41 catalog records**. Cloud definitions/parameters remain separately preserved; attaching a NAS declaration is not blanket runtime or parameter validation of every alternative regional API.

| Area | Parity / actual difference | NAS evidence |
|---|---|---|
| Normal HTTP contract | 30 s timeout, form serializer, object-data append guard, token/nasid, rnd/webagent and cluster/current-origin prefixing remain. NAS additionally maps apiTarget=email to the same api.zenithspace.net host as server. | N02,N03; module89904 at 1433680 |
| Email authentication support | /v2/email/send,/check,/modify switch from apiTarget=server to email; destination remains the same. NAS adds POST /v2/email/send/msg (export Tv). Its data fields/caller are unresolved in this bounded pass. | N05; auth41718 at 421250 |
| Token state | NAS initializes FAKE_TOKEN only for location.port8235/8236. appendParams clears the destination token/zenithtoken field when the proposed appended value equals that sentinel. Captured port5055 does not select this initialization branch. This is a client placeholder, not evidence of a backend auth bypass. | N02,N04 |
| Credential crypto and cookies | The complete RSA encrypt function m and fallback decrypt function p are text-identical. Cookie helper39632 and regional flag78296 modules are also text-identical. Ordinary login still encrypts username/password separately and sends email proof under sms_proof. | N06,N10,N11; catalog nas_comparison.exact_text_comparisons |
| Login/verification UI | Main login changes from cloud18020/chunk62931 to NAS30975/chunk44036; verification2601 to38702; OAuth27331/9872 to68664/58668. NAS default password recovery adds SMS/email method selection, and verification send handlers wait for success before progressing. OAuth os/source/redirectUrl and access_token/expires_in handoff remain. | N07,N08,N09; route context55202 at107986 |

The inspected normal NAS login still contains the cloud tracker/getcluster path and **id HTTP header**, with the same rawAjax fourth-argument header convention. Presence of that branch does not mean it was taken at the captured local origin. The captured local origin can serve relative /key/pub and /auth/login requests without the desktop DLL route; no such request was sent here. Core wrapper method/path declarations match the cloud catalog, including existing-session /auth/token and MFA/reset endpoints; no new global request-signature algorithm is established. [N06,N12]

Five bounded shared chunks were **byte-identical**: QR24394, LAN detector66837, entry455, old LAN jump61430 and shared62035. Their earlier source conclusions can be reused, with separate NAS URLs/hashes recorded in the catalog. The main login and OAuth chunks differ and were checked at their credential/verification/authorization boundaries; this is not a full frontend/UI comparison. Media route counts are outside this auth comparison and are not evidence of login changes.

### NAS exact evidence

Paths here explicitly start with `work/zspace-nas-web/`; all offsets remain zero-based UTF-16 code units. Long selected regions show initial/final exact fragments with separate offsets. Each NAS source URL and hash is retained in `web-login-api-catalog.json → nas_comparison.source_identity`.

#### N01

`work/zspace-nas-web/home/static/js/index.3608137b.js@1306047` (end-exclusive 1306102)

```javascript
version:"2.3.2026082801",deviceId:(0,n.Zw)(),videoTypes
```

#### N02

`work/zspace-nas-web/home/static/js/index.3608137b.js@1435193` (end-exclusive 1435643)

```javascript
v.appendParams=function(t,e){if("object"==(0,o._)(t.data)&&"put"!=t.method)for(var s in"post"==t.method?(t.data||(t.data={}),a=t.data):(t.params||(t.params={}),a=t.params),e){var a,i=e[s];("token"==s||"zenithtoken"==s)&&i===f&&(i="",a[s]=""),void 0===a[s]&&(a[s]=i)}},v.interceptors.request.use(function(t){var e="";if("server"==t.apiTarget||"email"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="https://znas.cn":"direct"==t.ap
```

#### N03

`work/zspace-nas-web/home/static/js/index.3608137b.js@1435461` (end-exclusive 1435901)

```javascript
v.interceptors.request.use(function(t){var e="";if("server"==t.apiTarget||"email"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="https://znas.cn":"direct"==t.apiTarget||(l.Z.state.app.clusterHost?(e="https://"+l.Z.state.app.clusterHost,t.withCredentials=!0):e=""),delete t.apiTarget,(-1==t.url.indexOf("downloader")&&(-1==t.url.indexOf("transfer")||/^\/znetdisk/gi.test(t.url))&&-1==t.url.indexOf("/play/")||/^\/zmusic
```

#### N04

`work/zspace-nas-web/home/static/js/index.3608137b.js@1344240` (end-exclusive 1344540)

```javascript
r="FAKE_TOKEN",c=["8235","8236"],l=function(t){var e=o.Z.get(t);return"0"==e?"":e};e.default={namespaced:!0,state:{token:function(){return c.includes(window.location.port)?r:l("zenithtoken")||l("token")}(),userid:o.Z.get("userid"),username:o.Z.get("username"),qcname:o.Z.get("qcname"),avatar:s(53148)
```

#### N05

`work/zspace-nas-web/home/static/js/index.3608137b.js@424727` (end-exclusive 425107)

```javascript
function A(t){return(0,a.Z)({url:"/v2/email/send",method:"post",apiTarget:"email",data:t})}function S(t){return(0,a.Z)({url:"/v2/email/send/msg",method:"post",apiTarget:"email",data:t})}function C(t){return(0,a.Z)({url:"/v2/email/modify",method:"post",apiTarget:"email",data:t})}function x(t){return(0,a.Z)({url:"/v2/email/check",method:"post",apiTarget:"email",data:t})}function 
```

#### N06

`work/zspace-nas-web/home/static/js/async/44036.022029bd.js@51784` (end-exclusive 52354)

```javascript
i=(0,l.Fd)(s,this.nasPubKey),N=(0,c.fy)(this.form.props.password),N=(0,l.Fd)(N,this.nasPubKey),T={username:i,password:N},"tiyan"===t&&this.genExperUser(T,"login"),!this.sms_proof)return[3,12];return[4,(0,n.x4)((0,o._)((0,a._)({},T),{sms_proof:this.sms_proof}))];case 11:case 13:return E=r.sent(),[3,16];case 12:if(!this.email_proof)return[3,14];return[4,(0,n.x4)((0,o._)((0,a._)({},T),{sms_proof:this.email_proof}))];case 14:return[4,(0,n.x4)(T)];case 15:E=r.sent(),r.label=16;case 16:return E.success?(this.$store.dispatch("user/setToken",E.data.token),this.$store.disp
```

#### N07

`work/zspace-nas-web/home/static/js/async/44036.022029bd.js@11769` (end-exclusive 12249)

```javascript
selectEmailVerification:function(){return(0,i._)(function(){var t;return(0,r.Jh)(this,function(e){switch(e.label){case 0:if(this.button_loading)return[2];if(this.errorMsg="",!this.recoveryEmail)return(0,_.D)({content:'你未填写用于安全验证的邮箱地址，请使用短信验证码进行安全验证。<br/><div style="margin-top:8px"> 登录完成之后你可以到“我的账号”页面进行验证邮箱的设置</div>',confirm:"知道了",cancel:null,header:"邮箱验证码"}),[2];return this.smsCode="",this.button_loading=!0,[4,(0,n.HK)({email:(0,l.Fd)((0,c.fy)(this.recoveryEmail),this.cloudPu
```

Middle of selected region omitted.

`work/zspace-nas-web/home/static/js/async/44036.022029bd.js@12449` (end-exclusive 12619)

```javascript
function(t){this.sendPhoneNum=t},getSmsError:function(t){this.errorMsg=t},onSendVoice:function(){var t=this;this.showVoiceTips=!0,window.setTimeout(function(){t.showVoice
```

#### N08

`work/zspace-nas-web/home/static/js/async/38702.b3f9900b.js@1578` (end-exclusive 2058)

```javascript
sendSms:function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"";return(0,s._)(function(){var t,n,s,i,o;return(0,c.Jh)(this,function(c){switch(c.label){case 0:return t=(0,a.fy)(this.email),n=(0,r.Fd)(t,this.cloudPubKey),s=this.remoteSign||this.sign,i={email:n,key_id:this.cloudPubKeyId,nasid:s},this.type&&(i.type=this.type),e&&(i.by=e),[4,(0,u.HK)(i)];case 1:if((o=c.sent()).success||200==o.code)return[2,!0];return this.$emit("errMsg",o.message),[2,!1]}})}).ca
```

Middle of selected region omitted.

`work/zspace-nas-web/home/static/js/async/38702.b3f9900b.js@2558` (end-exclusive 2728)

```javascript
dth>296},attrs:{placeholder:e.$t("common_user_verification_code_required"),type:"text"},on:{input:e.send},nativeOn:{keyup:function(t){return!t.type.indexOf("key")&&e._k(t
```

#### N09

`work/zspace-nas-web/home/static/js/async/58668.a18d4617.js@6169` (end-exclusive 6649)

```javascript
d.ZP.oauthAuthorize({os:b,source:C,redirectUrl:k})];case 9:return 200===(w=r.sent()).code?(V=(P=w.data).access_token,S=P.expires_in,(K=new URL(decodeURIComponent(k))).searchParams.set("token",V),K.searchParams.set("expires_in",S),window.location.href=K.toString()):(this.noticeVisible=!0,this.loginLoading=!1,this.tips=w.message||"授权失败"),[3,11];case 10:return $=r.sent(),this.noticeVisible=!0,this.loginLoading=!1,this.tips=$.message||"授权请求异常",[3,11];case 11:return[3,13];case 12:
```

#### N10

`work/zspace-nas-web/home/static/js/index.3608137b.js@1352922` (end-exclusive 1353252)

```javascript
function m(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u,s=new i.X;if(s.setPublicKey(e),e!=u)return s.encrypt(t);for(var a=[];t;){var o=t.substr(0,50);a.push(s.encrypt(o)),t=t.substr(50)}return a.join("~")}function p(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:d,s=new i.X;s.setPrivateKey(e
```

#### N11

`work/zspace-nas-web/home/static/js/index.3608137b.js@1365913` (end-exclusive 1366451)

```javascript
39632:function(t,e,s){"use strict";var a=s(36808),o=s.n(a),i={path:"/"},n=!1;window.location.host.toLowerCase().includes("zconnect.cn")&&(n=!0,i.domain=".".concat("zconnect.cn")),e.Z={set:function(t,e){var s=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null;"true"!=window.localStorage.getItem("keepLogin")||s||(s=360);var a=Object.assign({},i);s&&(a.expires=s),o().set(t,e,a)},remove:function(t){o().remove(t),o().remove(t,i),n&&o().remove(t,{path:"/",domain:"www.".concat("zconnect.cn")})},get:function(t){return o().get(t)}}}
```

#### N12

`work/zspace-nas-web/home/static/js/async/44036.022029bd.js@50243` (end-exclusive 51003)

```javascript
v="https://".concat("proxy.zenithspace.net","/tracker/query?platform=nas&zrp=v2"),[4,d.ZP.rawAjax(v,"get",{},{id:_.data.nasid})];case 4:return(f=r.sent()).success&&(w=f.data.local_addrs||"")&&this.$store.dispatch("nas/setNasIp",w.split(";")),y=C()(_.data.nasid).substring(0,8),k=JSON.parse(localStorage.getItem("clusters")||"{}"),x="https://".concat("zrpl-ucloud.zenithspace.net","/v2/getcluster?action=login"),[4,d.ZP.rawAjax(x,"get",{},{id:_.data.nasid})];case 5:return(S=r.sent()).success?(this.$store.dispatch("app/setClusterHost",S.data),k[y]=S.data,localStorage.setItem("clusters",JSON.stringify(k))):k[y]&&this.$store.dispatch("app/setClusterHost",k[y]),[3,7];case 6:return this.tips=_.message||"获取设备信息失败，请检查设备联网情况后重试",this.loginLoading=!1,[2];case 7:re
```

## Exact source extracts

All paths below are relative to `work/zconnect-web` and identically named snapshot paths. Offsets are zero-based UTF-16 code units in decoded original source, not byte offsets. Each displayed fragment is exact; long regions show separate initial/final fragments with their own offsets. IDs are local report evidence labels, not REA Evidence IDs.
### H10

`home/static/js/index.a785a6de.js@1392099` (end-exclusive 1392799)

```javascript
_.interceptors.response.use(function(t){var e=f.find(function(t){return"img"===t.type})||{};e.ftype&&(e.name=(0,g.eh)(),e.name.split(",").forEach(function(t){h[t]=e.ftype}));var s=t.request.responseURL;if("504.html"===s.substr(-8))return y(504,"Cannot connect to NAS");var a=t.data;if(("application/octet-stream"==t.headers["content-type"]||"blob"==t.request.responseType)&&((a={}).data=t.data,a.code=t.status,a.msg=t.statusText),s.indexOf("/v2/file/list/stream")>-1&&Array.isArray(a)){var i=a.map(function(t){return{name:t.n,modify_time:t.mt,access_time:t.ct,is_dir:t.di,size:t.s,ftype:1==t.di?10:void 0}});a={code:200,data:{list:i,total:i.length}}}if(Array.isArray(a.list)&&void 0===a.code&&(a={cod
```

### R01

`home/static/js/index.a785a6de.js@80970` (end-exclusive 81510)

```javascript
55202:function(t,e,s){var a={"./jump":["17283","30475","61430"],"./oauthLogin":["27331","2601","9872"],"./components/qrcodeLogin.vue":["80056","62035","24394"],"./lanDetect":["26357","30475","66837"],"./components/loginPanel":["21485","17468"],"./switchUser":["26819","73005"],"./switchUser.vue":["26819","73005"],"./judgeMachineStatus":["1783","77614"],"./components/footerOpts":["68687","93706"],"./components/verificationCode.vue":["35790","69868","35735"],"./components/deviceSelector.vue":["49076","6411"],"./verificationCode":["80287"
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@82440` (end-exclusive 82620)

```javascript
hLogin.vue":["27331","2601","9872"],"./registryUpgradeDlg":["98327","3411"],"./components/email":["86499","57607"],"./entry":["41290","455"],"./registryUpgradeDlg.vue":["98327","34
```

### R02

`home/static/js/index.a785a6de.js@397973` (end-exclusive 398203)

```javascript
78296:function(t,e,s){"use strict";s.d(e,{H1:function(){return c},Tj:function(){return a},Xf:function(){return n},gu:function(){return i},m4:function(){return o},vc:function(){return r}});var a=!1,o=!0,i=[];function n(t){t=t||navi
```

### R03

`home/static/js/index.a785a6de.js@1141221` (end-exclusive 1141371)

```javascript
{path:"/login",name:"Login",component:function(){return s(55202)("./".concat(sc.Tj?"abroad":"index"))}},{path:"/oauthLogin",name:"OAuthLogin",componen
```

### H01

`home/static/js/index.a785a6de.js@1389695` (end-exclusive 1390195)

```javascript
var _=c().create({withCredentials:!1,timeout:3e4}),v=[function(t){var e=function(e){var a=t[e];Array.isArray(a)?a.forEach(function(t){s.push(e+"[]="+encodeURIComponent(t))}):s.push(e+"="+encodeURIComponent(a))},s=[];for(var a in t)e(a);return s.join("&")}],b=[function(t){return JSON.stringify(t)}];_.createGetUrl=function(t,e){return t+"?"+(0,m.wu)(e)},_.appendParams=function(t,e){var s;if("object"==(0,o._)(t.data)&&"put"!=t.method)for(var a in"post"==t.method?(t.data||(t.data={}),s=t.data):(t.pa
```

### H02

`home/static/js/index.a785a6de.js@1390049` (end-exclusive 1390404)

```javascript
_.appendParams=function(t,e){var s;if("object"==(0,o._)(t.data)&&"put"!=t.method)for(var a in"post"==t.method?(t.data||(t.data={}),s=t.data):(t.params||(t.params={}),s=t.params),e)void 0===s[a]&&(s[a]=e[a])},_.interceptors.request.use(function(t){var e="";if("server"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="https://znas.cn":"
```

### H03

`home/static/js/index.a785a6de.js@1390257` (end-exclusive 1390797)

```javascript
_.interceptors.request.use(function(t){var e="";if("server"==t.apiTarget?e="https://api.zenithspace.net":"share"==t.apiTarget?e="https://znas.cn":"direct"==t.apiTarget||(l.Z.state.app.clusterHost?(e="https://"+l.Z.state.app.clusterHost,t.withCredentials=!0):e=""),delete t.apiTarget,(-1==t.url.indexOf("downloader")&&(-1==t.url.indexOf("transfer")||/^\/znetdisk/gi.test(t.url))&&-1==t.url.indexOf("/play/")||/^\/zmusic\/api/gi.test(t.url))&&(t.url=e+t.url),-1!=t.url.indexOf("/docker/api")||t.forRemoteNas||t.requestAsJson||_.appendParams(t
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1390877` (end-exclusive 1391057)

```javascript
ce:l.Z.state.app.device,_l:l.Z.state.language.language}),t.requestAsJson?t.transformRequest=b:"post"!=t.method||t.headers["Content-Type"]||(t.headers["Content-Type"]="application/x
```

### H04

`home/static/js/index.a785a6de.js@1390934` (end-exclusive 1391474)

```javascript
t.requestAsJson?t.transformRequest=b:"post"!=t.method||t.headers["Content-Type"]||(t.headers["Content-Type"]="application/x-www-form-urlencoded",t.forRemoteNas||_.appendParams(t,{token:l.Z.state.user.token,nasid:l.Z.state.nas.nasId}),t.transformRequest=v),(t.url.indexOf("/settings?create_container")>-1||t.url.indexOf("/docker/api")>-1)&&-1==t.url.indexOf("/docker/api/auth")){var s=window.__rootEmit("fetchStore","docker.dockerToken");t.headers.Authorization=s}var a=new Date().getTime();t.metadata||(t.metadata={}),t.metadata.startTime=a
```

### H05

`home/static/js/index.a785a6de.js@1391397` (end-exclusive 1391877)

```javascript
var a=new Date().getTime();t.metadata||(t.metadata={}),t.metadata.startTime=a;var o=a+"_"+Math.floor(1e4*Math.random());return"post"==t.method?(0>t.url.indexOf("?")&&(t.url+="?"),t.url+="&rnd="+o+"&webagent=v2"):(t.params||(t.params={}),!t.params.rnd&&0>t.url.indexOf("rnd=")&&(t.params.rnd=o),t.params.webagent="v2"),t},function(t){return console.log("request error",t),Promise.reject(t)});var k=function(t){var e=new Date().getTime();window.top.__rootEmit&&(t?(window.top.__root
```

### H06

`home/static/js/index.a785a6de.js@1393373` (end-exclusive 1394073)

```javascript
if(0>s.indexOf(p.Tj?"dispatch.ud.link":".zenithspace.net")&&k(!0),200!=a.code&&"S000200"!==a.code)return"N001603"==a.code?(window.top.__rootEmit("jumpSafeboxLogin"),window.top.__rootEmit("closeNoteFormSafebox")):"N001602"==a.code?window.top.__rootEmit("regetBoxStatus"):"N007104"==a.code&&window.top.__rootEmit("encrypt_goRootDirectory",{responseUrl:s}),t.config&&"object"==(0,o._)(t.config)&&("get"==t.config.method&&console.log("axios params:",t.config.params),"post"==t.config.method&&t.config.headers&&"application/octet-stream"!=t.config.headers["Content-Type"]&&console.log("axios data:",t.config.data)),y(a.code,a.msg,a.data,s,a.reason||"");if(t.config.metadata&&t.config.metadata.startTime){v
```

### H07

`home/static/js/index.a785a6de.js@1397167` (end-exclusive 1397707)

```javascript
!a&&["N001207","N001208","N001100","N001413","N001001","N001209"].includes(t)&&(c=d.Z.get("zenithtoken")||d.Z.get("token"))&&"0"!=c&&(l.Z.state.user.token!=c?window.top.location.reload():"N001413"==t?window.top==window&&"/home/login"!=window.location.pathname&&(0,u.MessageBox)({title:(0,n.$t)("common_prompt_notice"),message:(0,n.$t)("nidezhangh_ace617"),confirmButtonText:(0,n.$t)("common_button_ok"),showClose:!1,showCancelButton:!1,closeOnClickModal:!1,closeOnPressEscape:!1,customClass:"alert"}).then(function(){window.top.__rootEmit("
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1397987` (end-exclusive 1398167)

```javascript
)]})})()};e.Z=_},54746:function(t,e,s){"use strict";s.d(e,{dD:function(){return n},ht:function(){return r},py:function(){return i}});var a=s(29995),o=s(84401),i=function(t,e){var s
```

### H08

`home/static/js/index.a785a6de.js@363828` (end-exclusive 364313)

```javascript
function l(t,e,s){var o=arguments.length>3&&void 0!==arguments[3]?arguments[3]:{},i=arguments.length>4&&void 0!==arguments[4]?arguments[4]:3e4,n={url:t,method:e,apiTarget:"direct",headers:o,timeout:i};return s&&("get"==e?n.params=s:n.data=s,s.requestAsJson&&(n.requestAsJson=1,delete s.requestAsJson)),(0,a.Z)(n)}function d(t,e){return t.forRemoteNas=!0,t.headers={rtoken:e.token,rdeviceid:e.device_id,rdevice:e.device,ruser:e.username},t}function u(t){return(0,a.Z)({url:"/system/poll
```

### H09

`home/static/js/index.a785a6de.js@364141` (end-exclusive 364301)

```javascript
function d(t,e){return t.forRemoteNas=!0,t.headers={rtoken:e.token,rdeviceid:e.device_id,rdevice:e.device,ruser:e.username},t}function u(t){return(0,a.Z)({url:"
```

### C01

`home/static/js/index.a785a6de.js@1313590` (end-exclusive 1313920)

```javascript
function m(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:u,s=new i.X;if(s.setPublicKey(e),e!=u)return s.encrypt(t);for(var a=[];t;){var o=t.substr(0,50);a.push(s.encrypt(o)),t=t.substr(50)}return a.join("~")}function p(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:d,s=new i.X;s.setPrivateKey(e
```

### C02

`home/static/js/index.a785a6de.js@1334187` (end-exclusive 1334262)

```javascript
function G(t){return String(t).replace(/(^\s*)|(\s*$)/g,"")}function Q(){va
```

### C03

`home/static/js/34693.faa26133.js@3642967` (end-exclusive 3643437)

```javascript
function Ag(A,i){if(i<A.length+11)return console.error("Message too long for RSA"),null;for(var e=[],t=A.length-1;t>=0&&i>0;){var r=A.charCodeAt(t--);r<128?e[--i]=r:r>127&&r<2048?(e[--i]=63&r|128,e[--i]=r>>6|192):(e[--i]=63&r|128,e[--i]=r>>6&63|128,e[--i]=r>>12|224)}e[--i]=0;for(var n=new An,o=[];i>2;){for(o[0]=0;0==o[0];)n.nextBytes(o);e[--i]=o[0]}return e[--i]=2,e[--i]=0,new Y(e)}var Aa=function(){function A(){this.n=null,this.e=0,this.d=null,this.p=null,this.q=nu
```

### C04

`home/static/js/34693.faa26133.js@3666299` (end-exclusive 3666389)

```javascript
prototype.encrypt=function(A){try{return d(this.getKey().encrypt(A))}catch(A){return!1}},A
```

### C05

`home/static/js/index.a785a6de.js@1314838` (end-exclusive 1314983)

```javascript
function w(){var t=localStorage.getItem(l);return null==t&&(t=o()(S()),localStorage.setItem(l,t)),t}function C(t){localStorage.setItem(l,t)}funct
```

### C06

`home/static/js/34693.faa26133.js@3602019` (end-exclusive 3602319)

```javascript
88495:function(module,__unused_webpack_exports,__webpack_require__){var process=__webpack_require__(34155);!function(){"use strict";var ERROR="input is invalid type",WINDOW="object"==typeof window,root=WINDOW?window:{};root.JS_MD5_NO_WINDOW&&(WINDOW=!1);var WEB_WORKER=!WINDOW&&"object"==typeof self,
```

### F01

`home/static/js/async/62931.614afdfb.js@42757` (end-exclusive 43297)

```javascript
validateSuccess:function(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"normal";return(0,i._)(function(){var e,s,i,h,g,p,m,_,v,f,b,C,k,x,S,P,$,D,I,N,T,L,M;return(0,n.Jh)(this,function(n){switch(n.label){case 0:if(e=this,this.$store.dispatch("app/setClusterHost",""),this.loginWithSmsError=!1,s=(0,c.fy)(this.form.props.username),"cloud"!=this.network)return[3,8];if(!(!this.cloudPubKey||!this.cloudPubKeyId))return[3,2];return[4,(0,r.$3)("server")];case 1:if(!(h=n.sent()).success)return this.tips="获取信息失败，请稍后重试",this.login
```

Middle of selected region omitted.

`home/static/js/async/62931.614afdfb.js@45277` (end-exclusive 45457)

```javascript
I=$.data.sign,N=$.data.name,this.$store.dispatch("nas/setNasName",N),this.$store.dispatch("nas/setPubKey",{nasPubKey:D,sign:I}),i=(0,l.Fd)(s,this.nasPubKey),T=(0,c.fy)(this.form.pr
```

### F02

`home/static/js/async/62931.614afdfb.js@45405` (end-exclusive 45945)

```javascript
i=(0,l.Fd)(s,this.nasPubKey),T=(0,c.fy)(this.form.props.password),T=(0,l.Fd)(T,this.nasPubKey),L={username:i,password:T},"tiyan"===t&&this.genExperUser(L,"login"),!this.sms_proof)return[3,12];return[4,(0,r.x4)((0,o._)((0,a._)({},L),{sms_proof:this.sms_proof}))];case 11:case 13:return M=n.sent(),[3,16];case 12:if(!this.email_proof)return[3,14];return[4,(0,r.x4)((0,o._)((0,a._)({},L),{sms_proof:this.email_proof}))];case 14:return[4,(0,r.x4)(L)];case 15:M=n.sent(),n.label=16;case 16:return M.success?(this.$store.dispatch("user/setToken",
```

### F03

`home/static/js/async/62931.614afdfb.js@45897` (end-exclusive 46437)

```javascript
M.success?(this.$store.dispatch("user/setToken",M.data.token),this.$store.dispatch("user/setUserName",M.data.username),this.$store.dispatch("user/setQcName",M.data.qc_name),this.$store.dispatch("user/setNickName",M.data.nickname||""),this.$store.dispatch("user/setUserInfo",M.data),this.$store.dispatch("user/setAvatar",M.data.avatar),this.$stat.push({key:"login_complete",acode:this.$stat.ACODE.LOGIN,ap:"login",cur_url:"login"}),d.ZP.systemPoll().then(function(s){if(s.success&&(s.data.color&&e.$store.dispatch("nas/setDevColor",s.data.co
```

Middle of selected region omitted.

`home/static/js/async/62931.614afdfb.js@46817` (end-exclusive 46997)

```javascript
ngth&&"cloud"==e.network?e.tryLocalIpHttps(i):window.location.href=i+"?"+a}})):(this.noticeVisible=!0,this.loginLoading=!1,this.tips=M.message||"连接超时，请稍后重试",this.tipsCode=M.code||"
```

### F04

`home/static/js/async/62931.614afdfb.js@47050` (end-exclusive 47590)

```javascript
"N001204"==M.code?(this.messageDialogVisible=!0,this.smsCheckType=""):"N001100"==M.code?this.tips="密码重置中，请用手机APP完成密码重置":"N001414"==M.code?(this.smsCheckType="new_device",this.newDeviceCheck=!0):"N001413"==M.code?this.$root.$myConfirm.show("你使用的账号被禁止外网登录，是否尝试使用IP登录？","提示",{confirmButtonText:"IP登录"}).then(function(){var t="/".concat(e.basePath,"/");e.tryLocalIpHttps(t)}):"N150061"==M.code?this.$root.$myAlert.show("当前IP地址还有最后一次尝试机会，账号密码仍然错误将会锁定该IP，通过当前IP地址将无法登录极空间",(0,u.$t)("common_prompt_warning"),"",(0,u.$t)("common_button_got_it"),356
```

Middle of selected region omitted.

`home/static/js/async/62931.614afdfb.js@47990` (end-exclusive 48170)

```javascript
de=""},startCheckNewDeviceByEmail:function(){return(0,i._)(function(){var t,e,s,i;return(0,n.Jh)(this,function(a){switch(a.label){case 0:return this.clearSmsMessage(),this.form.pro
```

### F05

`home/static/js/async/62931.614afdfb.js@42147` (end-exclusive 42437)

```javascript
this.ifRemember?window.localStorage.setItem("rememberUsername",this.form.props.username):window.localStorage.removeItem("rememberUsername"),window.localStorage.setItem("ifRemember",this.ifRemember),window.localStorage.setItem("keepLogin",this.keepLogin),this.loginLoading=!0,this.form.emitV
```

### F06

`home/static/js/async/62931.614afdfb.js@33195` (end-exclusive 33635)

```javascript
tryLocalIpHttps:function(t){var e=String(this.remoteVerson||"").trim().split("."),s=e[e.length-1]||"",i=/^\d{10}$/.test(s),a=!1;if(i&&(a=0x13525e7>parseInt(s.slice(0,8),10)),a){var o=this.$store.state.app.clusterHost||window.location.host,n=this.basePath||"";window.location.href="http://".concat(o,"/").concat(n,"/login/jump");return}window.location.href="/home/login/lanDetect"},showForgetPasswordDialog:function(){this.forgetPasswordDial
```

### F07

`home/static/js/async/62931.614afdfb.js@49039` (end-exclusive 49659)

```javascript
w.Z.remove("nas_id"),w.Z.remove("token"),w.Z.remove("zenithtoken"),w.Z.remove("nasPubKey"),w.Z.remove("cloudPubKey"),w.Z.remove("cloudPubKeyId"),w.Z.remove("username"),w.Z.remove("plat"),w.Z.remove("app"),w.Z.remove("sign"),w.Z.remove("nas_name"),w.Z.remove("device"),w.Z.remove("isMaster"),w.Z.remove("avatar"),w.Z.remove("deviceColor"),w.Z.remove("devicePdt"),w.Z.remove("st"),w.Z.remove("clientPublicIp"),localStorage.removeItem("cv_pictures_json"),this.$inElectron)return void this.$ipc.send("signout",!0);var t=window.navigator.userAgent,e=/Chrome\/(.+?)( |$)/.exec(t);if(e&&49>=parseInt(e[1])&&(this.browserWarning
```

### S01

`home/static/js/index.a785a6de.js@1304982` (end-exclusive 1305522)

```javascript
31575:function(t,e,s){"use strict";s.r(e);var a=s(29995),o=s(39632),i=!1,n=/Electron/.test(navigator.userAgent)&&/(UnifyDrive|zspace)/i.test(navigator.userAgent),r=function(t){var e=o.Z.get(t);return"0"==e?"":e};e.default={namespaced:!0,state:{token:r("zenithtoken")||r("token"),userid:o.Z.get("userid"),username:o.Z.get("username"),qcname:o.Z.get("qcname"),avatar:s(53148),isMaster:parseInt(o.Z.get("isMaster")||0),isLocal:parseInt(o.Z.get("isLocal")||0),userinfo:{},authorize:0,nickname:o.Z.get("nickname"),userSetting:{share_disable:0,fl
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1305782` (end-exclusive 1305962)

```javascript
e)},SET_NAME:function(t,e){t.username=e,o.Z.set("username",e)},SET_QCNAME:function(t,e){t.qcname=e,o.Z.set("qcname",e)},SET_NICKNAME:function(t,e){t.nickname=e,o.Z.set("nickname",e
```

### S02

`home/static/js/index.a785a6de.js@1323768` (end-exclusive 1324378)

```javascript
39632:function(t,e,s){"use strict";var a=s(36808),o=s.n(a),i={path:"/"},n=!1;window.location.host.toLowerCase().includes("zconnect.cn")&&(n=!0,i.domain=".".concat("zconnect.cn")),e.Z={set:function(t,e){var s=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null;"true"!=window.localStorage.getItem("keepLogin")||s||(s=360);var a=Object.assign({},i);s&&(a.expires=s),o().set(t,e,a)},remove:function(t){o().remove(t),o().remove(t,i),n&&o().remove(t,{path:"/",domain:"www.".concat("zconnect.cn")})},get:function(t){return o().get(t)}}},84285:function(t,e,s){"use strict";s.d(e,{Y:function(){return u}});var 
```

### S03

`home/static/js/index.a785a6de.js@1284022` (end-exclusive 1284202)

```javascript
SET_NASID:function(t,e){t.nasId=e,n.Tj?localStorage.setItem("nasId",(0,i.ek)(e)):""===e?o.Z.remove("nas_id"):o.Z.set("nas_id",e)},SET_NETMODE:function(t,e){t.netMode=e,o.Z.set("net
```

### S04

`home/static/js/index.a785a6de.js@1137380` (end-exclusive 1137920)

```javascript
this.token&&((0,F.a_)({token:this.token}).then(function(e){if(e.success){var s;t.$store.dispatch("user/setUserName",e.data.username),t.$store.dispatch("user/setQcName",e.data.qc_name),t.$store.dispatch("user/setNickName",e.data.nickname||""),t.$store.dispatch("user/setUserInfo",e.data),t.$store.dispatch("user/setAuthorize",e.data.authorize),t.$store.dispatch("user/setUserPerm",e.data.perm),t.$store.dispatch("user/setAvatar",e.data.avatar||""),localStorage.setItem("uni_tag",(null==(s=e.data)?void 0:s.username)||""),t.hasCheckedToken=!0
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1138050` (end-exclusive 1138230)

```javascript
r&&t.$isGlobal&&(0,F.n2)().then(function(e){e.success&&t.$store.dispatch("user/setQcv",e.data.qcv)})}),(0,ta.Fv)().then(function(e){e.success&&t.$store.dispatch("nas/setNasId",e.da
```

### S05

`home/static/js/index.a785a6de.js@1208191` (end-exclusive 1208931)

```javascript
i="false"!=window.localStorage.getItem("keepLogin"),n=/Electron/.test(navigator.userAgent)&&/(UnifyDrive|zspace)/i.test(navigator.userAgent),a&&!i&&window.top==window&&!n&&(r=new Date().getTime(),c=ex.Z.get("st")||r,r-c>9e4?(console.log("*****lastRead",r,c),a="",ex.Z.remove("token"),ex.Z.remove("zenithtoken"),t7.Z.dispatch("user/setToken",""),window.__stTimer&&window.clearInterval(window.__stTimer),delete window.__stTimer):(ex.Z.set("st",r),window.__stTimer||(window.__stTimer=window.setInterval(function(){ex.Z.set("st",new Date().getTime())},1e3)))),a||-1!==sv.indexOf(t.path)||t.meta.noRequireAuth){if(t.meta.isMaster&&1!=o)return s("/404"),[2];u=t.matched.some(function(t){return t.meta.noNeedDynamicRoutes}),!a||sb||u?s():(sh.addRo
```

### Q01

`home/static/js/async/24394.d012f864.js@1441` (end-exclusive 1981)

```javascript
loopReadQrcode:function(){var t=this;clearTimeout(this.timer),this.timer=setTimeout(function(){return(0,r._)(function(){var t,e,s,r,n,a,i,o;return(0,c.Jh)(this,function(c){switch(c.label){case 0:return[4,(0,u.kh)({bcode:this.bcode})];case 1:if(e=(t=c.sent()).success,s=t.data,!(e&&(null==s?void 0:s.nasid)))return[3,3];return this.$store.dispatch("nas/setNasId",s.nasid),[4,(0,u.TB)({qltk:s.qltk})];case 2:if(n=(r=c.sent()).success,a=r.data,n)return this.$store.dispatch("user/setToken",a.token),this.$store.dispatch("user/setUserName",a.us
```

Middle of selected region omitted.

`home/static/js/async/24394.d012f864.js@2311` (end-exclusive 2491)

```javascript
ncat(o)),[2];c.label=3;case 3:return this.loopReadQrcode(),[2]}})}).call(t)},1e3)},getFromUrl:function(){return this.$route.query.from||"/".concat(this.basePath,"/")},outerNetLogin
```

### Q02

`home/static/js/async/24394.d012f864.js@2478` (end-exclusive 3018)

```javascript
outerNetLogin:function(){return(0,r._)(function(){var t,e,s,r,n,a,i,o,h,l,f,p,b,m,v,$,_,w;return(0,c.Jh)(this,function(c){switch(c.label){case 0:return t=this.getFromUrl(),e=new Date().getTime(),s="https://".concat("proxy.zenithspace.net","/tracker/query?platform=nas&zrp=v2"),[4,(0,d.ku)(s,"get",{},{id:this.nasId})];case 1:if(n=(r=c.sent()).success,a=r.data,!n||!a.local_addrs)return[2,window.location.href="".concat(t,"?").concat(e)];return this.$store.dispatch("nas/setNasIp",a.local_addrs.split(";")),[4,(0,u.$3)("nas")];case 2:return(
```

Middle of selected region omitted.

`home/static/js/async/24394.d012f864.js@3648` (end-exclusive 3828)

```javascript
cation.href="http://".concat(w,"/").concat(this.basePath,"/login/jump"),[2];return window.location.href="/home/login/lanDetect",[2]}})}).call(this)}},mounted:function(){this.getQrc
```

### L01

`home/static/js/async/66837.eacee639.js@6004` (end-exclusive 6734)

```javascript
var Q=function(t){var e=t&&t.data;if("string"==typeof e&&"xnas-ok"===e.substring(0,7)){var o=JSON.parse(e.substring(8)),i=o.readPubKey,a=o.token===p&&o.device_id===_;if(i&&i===$){O();var r=function(t){"1"===localStorage.getItem("SkipLoginReport")?window.location.href=t:(0,n.CT)().finally(function(){window.location.href=t})};if(a)r(t.origin+"/"+l+"/");else{var s=JSON.stringify([p,_,C,Date.now(),j]);r(t.origin+"/"+l+"/login/entry?tk="+encodeURIComponent((0,u.Fd)(s))+"&color="+encodeURIComponent(K)+"&pdt="+encodeURIComponent(E))}}}};window.addEventListener("message",Q,!1),i.forEach(function(t){if(t){var e=String(t).split(":")[0];if(e){var o=e.replace(/\./g,"-"),i=String(r).toLowerCase().replace("z4pro+","z4proplus"),a=docum
```

### L02

`home/static/js/async/66837.eacee639.js@6762` (end-exclusive 7262)

```javascript
a.onload=function(){a.contentWindow.postMessage(JSON.stringify({token:p,username:v,qcname:f,device_id:_,device:w,nas_id:C,cloudPubKeyId:I,cloudPubKey:D,nasPubKey:$,plat:A,version:M,color:K,devicePdt:L,deviceMode:E}),"*")},a.src="https://"+(o+"."+i+".")+d+":5056/"+l+"/bridge.html?t="+Date.now(),document.body.appendChild(a),J.push(a)}}})}({nasIp:t.nasIp,nasName:t.nasName,basePath:t.basePath,fromUrl:"/".concat(t.basePath,"/"),directDomain:i,token:t.token,username:t.username,qcname:t.qcname,deviceId
```

### L03

`home/static/js/async/66837.eacee639.js@5767` (end-exclusive 6152)

```javascript
Y=function(){if(O(),F){var t=R||window.location.host;window.location.protocol,Date.now(),window.location.href="https://".concat(t,"/").concat(l,"/")}};if(!r||!i||!i.length)return Y();H=window.setTimeout(function(){Y()},void 0===G?3e3:G);var Q=function(t){var e=t&&t.data;if("string"==typeof e&&"xnas-ok"===e.substring(0,7)){var o=JSON.parse(e.substring(8)),i=o.readPubKey,a=o.token===p
```

### L04

`home/static/js/async/455.1e31183f.js@1378` (end-exclusive 1948)

```javascript
t&&(i=JSON.parse((0,c.Y4)(t)))&&i.length>=3&&(a=i[0],o=i[1],n=i[2],l=i[3],this.isMaster=i[4]||!1,console.log({t1:l,t2:u=new Date().getTime(),dt:l-u}),Math.abs(l-u)>9e4?window.location="/home/login":(console.log({info:i,color:s,pdt:e}),this.$store.dispatch("user/setToken",a),this.$store.dispatch("nas/setNasId",n),this.$store.dispatch("app/setDeviceId",o),window.location="/home/")),[2]})}).call(this)},mounted:function(){}},d=(0,e(41772).Z)(u,function(){var t=this._self._c;return t("div",{staticClass:"contain",class:{abroad:this.$isGlobal,night:!this.$isGlobal&&this.
```

### L05

`home/static/js/async/61430.65791410.js@4496` (end-exclusive 5036)

```javascript
tryLocalIframe:function(t){var e=this,o=document.createElement("iframe");o.onload=function(){var t={token:e.token,username:e.username,qcname:e.qcname,device_id:e.deviceId,device:e.device,nas_id:e.nasId,cloudPubKeyId:e.cloudPubKeyId,cloudPubKey:e.cloudPubKey,nasPubKey:e.nasPubKey,plat:e.$store.state.app.plat,version:e.$store.state.app.version,color:e.color,devicePdt:e.devicePdt,deviceMode:e.deviceMode};o.contentWindow.postMessage(JSON.stringify(t),"*")},o.src="http://"+t+"/"+this.basePath+"/bridge.html?t="+new Date().getTime(),document
```

Middle of selected region omitted.

`home/static/js/async/61430.65791410.js@5086` (end-exclusive 5266)

```javascript
this;this.iframeTimer=window.setTimeout(function(){"N001413"==t.mode?t.jumpError=!0:t.reportAndJump(t.targetUrl)},this.checkTimeout),this.nasIp.forEach(function(e){""!=e&&(/:\d+/.t
```

### L06

`home/static/js/async/61430.65791410.js@5459` (end-exclusive 5999)

```javascript
"xnas-ok"==o.substring(0,7)){var i=JSON.parse(o.substring(8)),a=i.readPubKey,n=i.token==t.token&&i.device_id==t.deviceId;if(console.log({readPubKey:a,nasPubkey:t.nasPubKey,hasCookie:n}),""!=a&&a==t.nasPubKey)if(t.iframeTimer&&window.clearTimeout(t.iframeTimer),"N001413"==t.mode||n)t.reportAndJump(e.origin+"/"+t.basePath+"/");else{var r=JSON.stringify([t.token,t.deviceId,t.nasId,new Date().getTime(),t.isMaster]),l=e.origin+"/"+t.basePath+"/login/entry?tk="+encodeURIComponent((0,s.Fd)(r))+"&color="+encodeURIComponent(t.color)+"&pdt="+en
```

Middle of selected region omitted.

`home/static/js/async/61430.65791410.js@6219` (end-exclusive 6399)

```javascript
l_addrs||"";o&&t.$store.dispatch("nas/setNasIp",o.split(";"))}t.tryLocalIp()})}},m=(0,o(41772).Z)(p,function(){var t=this,e=t._self._c;return e("div",{staticClass:"contain",class:{
```

### O01

`home/static/js/async/9872.3987cd3c.js@3100` (end-exclusive 3440)

```javascript
doValidate:function(){if(!this.oauthParams.os||!this.oauthParams.source||!this.oauthParams.redirectUrl){this.tips="缺少必要的参数: os, source, redirectUrl";return}if(this.form.props.username){if(!this.form.props.password){this.tips="请输入密码";return}}else{this.tips="请输入账号";return}this.isLocalAccount=/^[a-zA-Z].+$/.test(this.form.props.username),thi
```

### O02

`home/static/js/async/9872.3987cd3c.js@5344` (end-exclusive 5904)

```javascript
m.ZP.oauthAuthorize({os:b,source:C,redirectUrl:k})];case 9:return 200===(w=r.sent()).code?(V=(P=w.data).access_token,S=P.expires_in,(E=new URL(decodeURIComponent(k))).searchParams.set("token",V),E.searchParams.set("expires_in",S),window.location.href=E.toString()):(this.noticeVisible=!0,this.loginLoading=!1,this.tips=w.message||"授权失败"),[3,11];case 10:return N=r.sent(),this.noticeVisible=!0,this.loginLoading=!1,this.tips=N.message||"授权请求异常",[3,11];case 11:return[3,13];case 12:this.noticeVisible=!0,this.loginLoading=!1,this.tips=_.message||"连接超时，请稍后重试",thi
```

### A01

`home/static/js/async/57607.c2a73bb0.js@2686` (end-exclusive 2996)

```javascript
[4,(0,l.qo)({key_id:this.cloudPubKeyId,email:(0,u.Fd)(this.emailVal,this.cloudPubKey),uuid:this.uuid,captcha_code:this.captchaVal,check:this.isCheck}).finally(function(){t.loading=!1})];case 1:return e=(a=n.sent()).success,c=a.message,e?this.handleSuccess():this.errMsg=c,[2]}})}).call(this)},loadCaptcha:funct
```

### A02

`home/static/js/async/69868.92ddb55d.js@781` (end-exclusive 1231)

```javascript
[4,(0,r.B3)({email:(0,l.Fd)(this.email,this.cloudPubKey),vcode:this.codeStr,device:this.device}).finally(function(){t.loading=!1})];case 1:return s=(e=o.sent()).success,i=e.data,n=e.message,s?(this.$store.dispatch("nas/setCloudToken",i.token),this.$store.commit("login/SET_CURR_PANEL","deviceSelector")):this.errMsg=n,[2]}})}).call(this)},goBack:function(){this.$store.commit("login/SET_CURR_PANEL","email")}}},p=(0,s(41772).Z)(d,function(){var t=thi
```

### A03

`home/static/js/async/6411.779eba77.js@750` (end-exclusive 1180)

```javascript
[4,(0,d.qr)({token:this.cloudToken}).finally(function(){t.showLoading=!1})];case 1:return e=(s=a.sent()).success,i=s.data,c=s.message,l=s.code,e?this.list=i.list.filter(function(t){return 10===t.state&&(!!t.activated||!t.activated&&1e3*t.activedtimeout>+Date.now())}).map(function(t){return(0,o._)((0,n._)({},t),{displayName:"".concat(t.model,"-").concat(t.nasid.slice(-4))})}):(this.$message({message:c,type:"error"}),["S001073",
```

### A04

`home/static/js/index.a785a6de.js@1383103` (end-exclusive 1383643)

```javascript
35869:function(t,e,s){"use strict";s.d(e,{Z:function(){return B}});var a=s(76150),o=s(28395),i=s(17401),n=s(88495),r=s.n(n),c=s(84401),l=s(89904),d=s(34155).env.VUE_APP_ZLINK_BASE_API,u=h,m=f,p=_,g=v;function h(){return(0,l.Z)({url:d+"/v2/ud/key/pub",method:"get",apiTarget:"direct"})}function f(t){return(0,l.Z)({url:d+"/v2/ud/agree",method:"post",data:t,apiTarget:"direct"})}function _(t){return(0,l.Z)({url:d+"/v2/ud/expire",method:"post",data:t,apiTarget:"direct"})}function v(t){return(0,l.Z)({url:d+"/v2/ud/check",method:"post",data:t
```

### A05

`home/static/js/index.a785a6de.js@1385900` (end-exclusive 1386440)

```javascript
case 2:return g=(d=(0,y.DO)())+"_"+Math.random()+new Date().getTime(),h=b.createHash("sha256").update(g).digest("hex"),f=(0,y.Fd)(h,n),[4,m({uuid:d,rid:f,key_id:r})];case 3:if(!(_=o.sent()).success)return[3,10];o.label=4;case 4:for(o.trys.push([4,8,,9]),v=_.data.agree_info,x=A.from(_.data.rid,"base64"),D=A.alloc(2*h.length),I=0;I<h.length;I++)D[2*I]=h.charCodeAt(I),D[2*I+1]=x[I];if(T=(P=b.createHash("sha256").update(D).digest()).slice(0,16),P=P.slice(0,32),(E=b.createDecipheriv("aes-256-cbc",P,T)).setAutoPadding(!0),F=A.from(v,"base64
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1387330` (end-exclusive 1387510)

```javascript
12];return[4,u()];case 11:(H=o.sent()).success&&c.Z.dispatch("nas/setQcPubKey",H.data),o.label=12;case 12:return[2,{code:"QC004",message:_.message||(0,i.$t)("common_prompt_request_
```

### A06

`home/static/js/index.a785a6de.js@1384291` (end-exclusive 1384686)

```javascript
M=function(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"global",s=D(e);if(s.timeLeft<0||!s.aesKey||!s.aesIv)return"";var a=b.createCipheriv("aes-256-cbc",s.aesKey,s.aesIv),o=a.update(t,"utf8");return(o=A.concat([o,a.final()])).toString("base64")},I=function(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"global",s=D(e);if(s.timeLeft<0||!s.aesKey||!s.aesIv)
```

### A07

`home/static/js/index.a785a6de.js@1314009` (end-exclusive 1314549)

```javascript
for(var g=Math.floor(1e5*Math.PI),h="",f=new n.Z(g),_=0;_<64;_++)h+=g=f.genrand_int32();var v=r.createHash("sha256").update(h).digest(),b=v.slice(0,32),k=v.slice(0,12);function y(t){var e=r.createCipheriv("aes-256-gcm",b,k),s=e.update(t,"utf8");s=c.concat([s,e.final()]);var a=e.getAuthTag();return c.concat([a,s]).toString("base64")}function A(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"";try{if(!t)return"";var e=c.from(t,"base64"),s=e.slice(0,16),a=e.slice(16),o=r.createDecipheriv("aes-256-gcm",b,k);o.setAuthTag(s)
```

Middle of selected region omitted.

`home/static/js/index.a785a6de.js@1314979` (end-exclusive 1315159)

```javascript
unction x(){var t=window.location.pathname;return t.indexOf("login")>-1?"/login":(t=encodeURIComponent(t),"/login?from=".concat(t))}function D(){for(var t=arguments.length>0&&void 
```

### T01

`home/static/js/async/84046.92eb489e.js@63045` (end-exclusive 63565)

```javascript
case 0:if(e=(0,y.fy)(this.verifyUserPasswordDialog.data.password),e=(0,w.Fd)(e,this.nasPubKey),t=(0,w.Fd)(this.username,this.nasPubKey),this.role!=(0,m.$t)("common_user_administrator"))return[3,2];return[4,(0,A.jY)({token:this.token,password:e})];case 1:return i.sent().success?(this.verifyUserPasswordDialog.visible=!1,this.verifyUserPasswordDialog.cb&&this.verifyUserPasswordDialog.cb()):this.showMessage((0,m.$t)("mimayanzhe_96b1bc"),"Error"),this.willOpenDestoryAccountDialog=!1,[3,4];case 2:return[4,(0,A.ni)({usern
```

### T02

`home/static/js/index.a785a6de.js@417807` (end-exclusive 418202)

```javascript
checkPwd:function(){var t=this,e=(0,k.fy)(this.confirmPwd);e=(0,Z.Fd)(e,this.nasPubKey);var s=(0,Z.Fd)(this.username,this.nasPubKey);(0,F.ni)({username:s,password:e}).then(function(e){e.success?(t.visible=!1,t.$ipc.send("clientDispatch",{key:"user/setLoginInfo",val:{lastActionTime:new Date().getTime(),lockNow:!1}})):t.errMsg=(0,g.$t)("mimayanzhe_96b1bc")})}},mounted:function(){this.$root.$on(
```

### V01

`home/static/js/async/2601.0a1f8b61.js@1390` (end-exclusive 1610)

```javascript
s=this.remoteSign||this.sign,i={email:n,key_id:this.cloudPubKeyId,nasid:s},this.type&&(i.type=this.type),e&&(i.by=e),[4,(0,l.HK)(i)];case 1:return 200==(r=c.sent()).code||this.$emit("errMsg",r.message),[2]}})}).call(this
```

### V02

`home/static/js/async/2601.0a1f8b61.js@3719` (end-exclusive 3939)

```javascript
s=this.remoteSign||this.sign,i={username:n,key_id:this.cloudPubKeyId,nasid:s},this.type&&(i.type=this.type),e&&(i.by=e),[4,(0,l.F0)(i)];case 1:return 200==(r=c.sent()).code?(i.by&&this.$emit("sendVoice"),r.data.phone&&th
```

### C07

`home/static/js/index.a785a6de.js@1313816` (end-exclusive 1314116)

```javascript
function p(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:d,s=new i.X;s.setPrivateKey(e);var a=t.split("~"),o=[];return a.forEach(function(t){o.push(s.decrypt(t))}),o.join("")}for(var g=Math.floor(1e5*Math.PI),h="",f=new n.Z(g),_=0;_<64;_++)h+=g=f.genrand_int32();var v=r.createHash(
```

### A08

`home/static/js/async/96377.5347ad04.js@4419` (end-exclusive 4709)

```javascript
[4,(0,l.iJ)({email:(0,u.Fd)(this.email,this.cloudPubKey),qcv:this.qcv,vcode:this.codeStr,_lc:this.username,_se:this.sendEmail}).finally(function(){t.$emit("loading",!1),t.loading=!1})];case 1:return s=(e=n.sent()).success,e.data,a=e.message,s?this.$emit("success"):this.errMsg=a,[2]}})}).ca
```

### F08

`home/static/js/index.a785a6de.js@1334068` (end-exclusive 1334223)

```javascript
function Y(){var t=location.host;return/\d+-\d+-\d+-\d+\..*/.test(t)?"local":t.includes("zconnect.cn")?"cloud":"local"}function G(t){return String(t).repla
```

### S06

`home/static/js/index.a785a6de.js@1284721` (end-exclusive 1285076)

```javascript
SET_PUBKEY:function(t,e){e.cloudPubKey?(t.cloudPubKey=e.cloudPubKey,t.cloudPubKeyId=e.cloudPubKeyId,o.Z.set("cloudPubKey",t.cloudPubKey,30),o.Z.set("cloudPubKeyId",t.cloudPubKeyId,30)):(t.sign=e.sign,t.nasPubKey=e.nasPubKey,l&&(o.Z.set("sign",t.sign),o.Z.set("nasPubKey",t.nasPubKey)))},SET_CLOUD_EMAIL:function(t,e){t.cloudEmail=e,o.Z.set("cloudEmail",e,
```

### E01

`home/static/js/async/62931.614afdfb.js@13703` (end-exclusive 14463)

```javascript
getCaptcha:function(){var t=this;(0,r.U8)().then(function(e){e.success&&(t.captchaImg=e.data.image,t.captcha_id=e.data.captcha_id,t.code_length=e.data.code_length,t.imgType=e.data.type)})},checkCaptcha:function(){var t=this;this.button_loading=!0,(0,r.dI)({captcha_id:this.captcha_id,captcha_code:this.code,append:this.username}).then(function(e){e.success?(t.captcha_proof=e.data.captcha_proof,t.checkUsername()):(t.errorMsg=e.message,t.getCaptcha(),t.button_loading=!1)})},checkUsername:function(){var t=this;if(0==this.username.length){this.errorMsg=(0,u.$t)("common_prompt_enter_account");return}if(this.username.length<11){this.errorMsg=(0,u.$t)("common_user_not_exist_pls_try_again");return}this.button_loading=!0;var e=(0,c.fy)(this.username);(0,r.pt)({
```

### E02

`home/static/js/async/62931.614afdfb.js@14775` (end-exclusive 15315)

```javascript
getNasIdFunc:function(){var t=!(arguments.length>0)||void 0===arguments[0]||arguments[0];return(0,i._)(function(){var e,s,i,a,o,d,h;return(0,n.Jh)(this,function(n){switch(n.label){case 0:return e=(0,c.fy)(this.username),s=(0,l.Fd)(e,this.cloudPubKey),[4,(0,r.cs)({username:s,key_id:this.cloudPubKeyId})];case 1:if(!(i=n.sent()).success)return[3,3];return this.$store.dispatch("nas/setNasId",i.data.nasid),this.$store.dispatch("user/setUserName",i.data.username),this.$store.dispatch("user/setQcName",i.data.qc_name),this.$store.dispatch("us
```

Middle of selected region omitted.

`home/static/js/async/62931.614afdfb.js@15495` (end-exclusive 15675)

```javascript
$store.dispatch("nas/setPubKey",{nasPubKey:o,sign:d})),t&&this.checkCaptcha(),[3,4];case 3:this.$message({message:i.message,type:"error",customClass:"messageError"}),n.label=4;case
```

### E03

`home/static/js/async/62931.614afdfb.js@13113` (end-exclusive 13773)

```javascript
checksms:function(){return(0,i._)(function(){var t,e,s;return(0,n.Jh)(this,function(i){switch(i.label){case 0:if(this.errorMsg="",4!=this.smsCode.length&&6!=this.smsCode.length)return this.errorMsg=(0,u.$t)("auto_trans_9aac23e577"),[2];return this.button_loading=!0,t=(0,c.fy)(this.username),e=(0,l.Fd)(t,this.cloudPubKey),[4,(0,r.Zs)({username:e,key_id:this.cloudPubKeyId,nasid:this.sign,sms_code:this.smsCode})];case 1:return(s=i.sent()).success?(this.show="reset",this.strengthLength=0,this.sms_proof=s.data.sms_proof):this.errorMsg=s.message,this.button_loading=!1,[2]}})}).call(this)},getCaptcha:function(){var t=this;(0,r.U8)().then(function(e){e.success
```

### E04

`home/static/js/async/62931.614afdfb.js@40952` (end-exclusive 41652)

```javascript
checksms:function(){return(0,i._)(function(){var t,e,s;return(0,n.Jh)(this,function(i){switch(i.label){case 0:if(4!=this.smsCode.length&&6!=this.smsCode.length)return this.smsTips="验证码有误",[2];return this.smsLoading=!0,t=(0,c.fy)(this.form.props.username),e=(0,l.Fd)(t,this.cloudPubKey),[4,(0,r.Zs)({username:e,key_id:this.cloudPubKeyId,nasid:this.sign,sms_code:this.smsCode})];case 1:return(s=i.sent()).success?(this.smsTips="验证通过",this.sms_proof=s.data.sms_proof,this.form.emitValidate^=1,this.messageDialogVisible=!1,this.newDeviceCheck=!1,this.smsVerifySuccess=!0):this.smsTips=s.message,this.smsLoading=!1,[2]}})}).call(this)},doReset:function(){this.form.emitReset^=1},showMessage:function(t,e){
```

## Source URLs and verified byte identities

| Relative path | Acquisition URL | SHA-256 |
|---|---|---|
| `home/static/js/index.a785a6de.js` | [index.a785a6de.js](https://zconnect.cn/home/static/js/index.a785a6de.js) | `51ac369cb2a4e88d247d5b0636f1417dc36ef8c7d382c6a019f72d197f337373` |
| `home/static/js/async/30475.dccf2ee3.js` | [30475.dccf2ee3.js](https://zconnect.cn/home/static/js/async/30475.dccf2ee3.js) | `c4b770ccfaf25de4e3f161a8e85473e03f741239c63397e45b835429c5510152` |
| `home/static/js/async/61430.65791410.js` | [61430.65791410.js](https://zconnect.cn/home/static/js/async/61430.65791410.js) | `1f31164ec4ea5f35d35125f5f1bd11c887118b9f59d03381767d452400616cb1` |
| `home/static/js/async/2601.0a1f8b61.js` | [2601.0a1f8b61.js](https://zconnect.cn/home/static/js/async/2601.0a1f8b61.js) | `0464f23d7ab6694c7650bd76be680b52bd836f9c8f86f200d9d42bdc53ffbda2` |
| `home/static/js/async/9872.3987cd3c.js` | [9872.3987cd3c.js](https://zconnect.cn/home/static/js/async/9872.3987cd3c.js) | `eed698747840db820fe0d3e8ea4a566ba8a3b07a2c9121263dfc6481f6e4eaf0` |
| `home/static/js/async/62035.4ebb067c.js` | [62035.4ebb067c.js](https://zconnect.cn/home/static/js/async/62035.4ebb067c.js) | `7513d39a4206204b6ae2145875268751be29e03e11a49eb04090484bffecda33` |
| `home/static/js/async/24394.d012f864.js` | [24394.d012f864.js](https://zconnect.cn/home/static/js/async/24394.d012f864.js) | `2e34d96e069813eaac9cc365af1b21f753e945164c1aa8287415044fcaa459ab` |
| `home/static/js/async/66837.eacee639.js` | [66837.eacee639.js](https://zconnect.cn/home/static/js/async/66837.eacee639.js) | `05f1019aa7862e8a8850cc6dd05913bc0d3eebf3bdab8b7676b63ea3b7f56fe6` |
| `home/static/js/async/17468.8292ebba.js` | [17468.8292ebba.js](https://zconnect.cn/home/static/js/async/17468.8292ebba.js) | `d3e90d540f91b4d625872d6a59cf4e16247eaa06061f5773a30301946ade8f73` |
| `home/static/js/async/73005.e5a9d05c.js` | [73005.e5a9d05c.js](https://zconnect.cn/home/static/js/async/73005.e5a9d05c.js) | `0ece36612ad123b7adb2a82a298509ddfd84870f752930fec4e38d92f8d3a992` |
| `home/static/js/async/77614.5bf291ae.js` | [77614.5bf291ae.js](https://zconnect.cn/home/static/js/async/77614.5bf291ae.js) | `f54b2ec80011526dcf341bcf64525b193c23d6b6578e9c7010496d8a8f3cf2bf` |
| `home/static/js/async/93706.0c05e6ac.js` | [93706.0c05e6ac.js](https://zconnect.cn/home/static/js/async/93706.0c05e6ac.js) | `e2064126d8d81ad59c6192920826f21ddd955f7301cd2abd50f45fbcc9308029` |
| `home/static/js/async/69868.92ddb55d.js` | [69868.92ddb55d.js](https://zconnect.cn/home/static/js/async/69868.92ddb55d.js) | `05d86b46051ca2d13b80fcdf60cf3092393ceddfad3ada02de56de8686aea293` |
| `home/static/js/async/6411.779eba77.js` | [6411.779eba77.js](https://zconnect.cn/home/static/js/async/6411.779eba77.js) | `0465ed8ee325bbf33e7ae5bb1b109c6378ff781af402e7d6faad3dd0f6561721` |
| `home/static/js/async/96869.66c599f4.js` | [96869.66c599f4.js](https://zconnect.cn/home/static/js/async/96869.66c599f4.js) | `849f6ec66f3b2a64e419c2b838b21fa0bb97f1e073f3da1fd4cce4b72927f82b` |
| `home/static/js/async/96377.5347ad04.js` | [96377.5347ad04.js](https://zconnect.cn/home/static/js/async/96377.5347ad04.js) | `7a3d4f2db1c3e0c68c7be1a5b94dfc40614b31603bc5dcf69453d78a7081398e` |
| `home/static/js/async/20295.bc02e13a.js` | [20295.bc02e13a.js](https://zconnect.cn/home/static/js/async/20295.bc02e13a.js) | `d0e562cb106673a48aa66a1f06d72a2a4a02be88b375fd1ec7ee93c9ed6fc539` |
| `home/static/js/async/30484.1861c2ed.js` | [30484.1861c2ed.js](https://zconnect.cn/home/static/js/async/30484.1861c2ed.js) | `820bb1acdf0e35556cc11ad16d89170d988745f4320b143740a34bec381c60dd` |
| `home/static/js/async/62931.614afdfb.js` | [62931.614afdfb.js](https://zconnect.cn/home/static/js/async/62931.614afdfb.js) | `642e8307892fbd85158e33a98c89aa30f18adcb97f8c4b23915954ec6fb54b98` |
| `home/static/js/async/455.1e31183f.js` | [455.1e31183f.js](https://zconnect.cn/home/static/js/async/455.1e31183f.js) | `608138f132dd6384fc781f93a09f538bd1d7a974288347f393f891ada77d1fb9` |
| `home/static/js/async/57607.c2a73bb0.js` | [57607.c2a73bb0.js](https://zconnect.cn/home/static/js/async/57607.c2a73bb0.js) | `a2644117207c2b7a854f21d4cb22f4342b9f2e2509c1c0ed05a6e178aac66b1b` |
| `home/static/js/async/3411.a391f20c.js` | [3411.a391f20c.js](https://zconnect.cn/home/static/js/async/3411.a391f20c.js) | `d2a8bc58a458683c1d67ff89d9f1dd9b4034c7f5c5ad4a1e44934384666684d4` |
| `home/static/js/async/4766.c2f46048.js` | [4766.c2f46048.js](https://zconnect.cn/home/static/js/async/4766.c2f46048.js) | `c2297976acdf0f059bec5231839e92d16a0017e94032987bac364bfbabe04dcf` |
| `home/static/js/34693.faa26133.js` | [34693.faa26133.js](https://zconnect.cn/home/static/js/34693.faa26133.js) | `7bd751625d438512e8cbebbf88b0339c553eb6be01ceaf4c4997afc2b302e28b` |
| `home/static/js/async/84046.92eb489e.js` | [84046.92eb489e.js](https://zconnect.cn/home/static/js/async/84046.92eb489e.js) | `47886aa9a25584b58b678ee82fbcd1229961fc1362524545b0968e4ac342242d` |

