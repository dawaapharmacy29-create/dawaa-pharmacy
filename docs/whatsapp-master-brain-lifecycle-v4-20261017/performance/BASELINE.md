# Performance baseline before optimization

Starting HEAD: 1fe3a962f42410921e1967412bcb52bf70e261d4. Node 22.23.3. No Production operations.

Selected canonical loader: 17 reads, 2 product reads, 0 pipeline runs/fuzzy reads (existing window fixture). Uniform 8ms/read transport model: 118.10ms total; product reads were sequential (83.25→91.59ms, then 91.61→99.78ms). This is a synthetic dependency measurement, not a network/browser or Production timing.

Bundle: 202.1 KiB gzip, 6 chunks, PASS.

Browser acquisition attempted using the runtime-provided Playwright executable. Chromium download failed: invalid/truncated ZIP, End of central directory record signature not found. No browser executable is installed. No remote service, paid resource, deploy, login or Production workaround was used.

| Required flow | Baseline measurement availability |
|---|---|
| App startup | Build bundle measured; first usable/visible render, mounts and long tasks unavailable |
| Conversations page | Browser requests/render timing unavailable |
| Conversation open | Canonical loader fixture measured; actual rendered conversation timing unavailable |
| Master Brain open | 17 fixture reads; 2 product reads; no full pipeline; first visible UI unavailable |
| Evaluation open | Existing canonical-facts-only path inspected; browser timing unavailable |
| Tabs | Conditional rendering inspected; browser switch/render/mount metrics unavailable |
| Search/filter | Existing local filtering inspected; browser input/stale result metrics unavailable |
| Customer details | Browser interaction/request measurement unavailable |
| Products / Requests | Selected loader product waterfall measured; full product/request page unavailable |
| Invoice details | Fixture invoice header/item reads overlap; full dialog unavailable |
| Follow-up details | Browser interaction/request measurement unavailable |
| Analysis | Existing pipeline tests available; complete stage timing not measured |
| Repeat Analysis | Existing idempotency tests available; stage timing not measured |
| Navigate away / return | Existing stale-request gate tests available; warm-navigation/render timing unavailable |

Unknown metrics are not zero: total browser requests, Supabase/RPC network calls, duplicate browser requests, render/mount counts, JS task execution, first content, first usable render, long tasks and memory retention remain UNMEASURED. No performance PASS can be claimed while these required flows remain unmeasured.
