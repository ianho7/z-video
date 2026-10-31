# Video and scan fix delivery

Date: 2026-11-01. Integrated fix source: 90c18c6.

User reported slow NAS scanning for about 23 movies and audio without video. Root observed the existing application remaining in its detail page after Play. The native owned-fixture probe confirmed incorrectly declared Koffi GetClientRect output left the native video child at 1x1. The fix marks output correctly, restores the player view and controls, raises the native child, preserves hidden state through resize, exits fullscreen and returns to the library on close.

After the user explicitly reauthorized Computer Use, Sky observed actual colored decoded fixture frames. Native child geometry was 2048x1000 and visible; a stopped child remained hidden after resize. Play/pause/seek/return were operated. Production fresh-process resume passed at 7.21s -> 7.21s; local player tests 5/5 and targeted typecheck/build passed. This is stronger than the earlier position-only proof; it does not establish every private codec or hardware decoder.

Scan optimizations reuse validated metadata/directory inventories and canonical root, avoid duplicate stat and DTO construction, group each media's synchronous SQL writes, and use a 512-entry NFO LRU. File/artwork IO is outside SQL transactions; concurrent playback and partial commits are protected. Profiler setup is cleanup-guarded and output failure cannot replace scan success. Artificial IO-delay code was removed from the final worker.

In an owned 23-item metadata fixture, recorded local baseline first/repeat scans 104.84/104.15ms changed to 71.46/47.59ms. Repeated NFO reads changed from 19 to 1 when one file was deliberately modified (18 cache hits); root-path calls roughly halved. These are owned local measurements, not the user's NAS speed. Process restart clears the NFO cache; persistent index/history remain. No private NAS directory was scanned.

Final ordinary-file package rebuilt after integration:
C:/Users/admin/.codex/visualizations/2026/10/30/01a18d67-6765-7dc0-8bd1-47ac85ca8f26/local-library-package/z-video-win32-x64/z-video.exe

Complete folder: 233 files, 503,167,969 bytes, zero reparse points. Package verify passed with isolated profile: native/XML probe and production renderer-to-SQLite empty query. Evidence: .scratch/local-library/runs/05-package-1793473451834-31864. Existing unverified boundaries (real NAS speed, all codecs/hardware, macOS, public redistribution) are not promoted to PASS.

Prior full legacy tests had environment/loopback failures; targeted changed-owner tests and the actual visual proof passed. No all-suite-pass claim. Details: video.md, scan.md and review-final.md. Runtime artifacts are preserved under root ignored .scratch/local-library/runs/video-scan-fixes.
