# Social load: what the server carries, what goes browser-to-browser (T-169, 19.11.2026)

Owner 19.11: «сделать более свободно, чтобы сервер меньше брал на себя нагрузки, но проверял просто». Rule kept: every decision that
matters (who may enter, limits, age, bans, passwords) stays on the server; only traffic that carries no decision moves away.

## Already direct between browsers (the server only signs a pass once)
- Voice / video in calls and voice channels: WebRTC mesh. The server gives a signed pass once (`cv_pass`, HMAC over uid, expiry,
  channel and the browser's public key); peers check each other's pass (`cv_check`, one call per new neighbour). Audio and video
  never touch Supabase or Vercel. TURN relay only when a direct path fails (or «скрыть адрес»).
- Files (📎): device to device over WebRTC data channels; the row keeps only metadata (`att`), checks run once in `msg_attach`.
- Noise suppression (T-169, `NS2_ON`, off by default): runs inside the browser (`d37-ns.wasm`), nothing extra leaves the device.

## Still through Supabase / Vercel (per user)
Measured in `scripts/t169-e2e.cjs` (phone profile, guest on /chat, 1 minute idle after the page settled; real requests, reads only):

| | before T-169 | after T-169 |
|---|---|---|
| REST requests in the idle minute | 18 | 10 |
| Realtime frames sent / received | 11 / 4 | 11 / 4 (unchanged) |
| REST requests while opening /chat | 44 | 48 (one more: site_voice_list; counts vary ±4 with what the page shows) |

Remaining 10: nick_extras ×2, season_levels ×2, file_blocked ×2, ds_people_meta ×3 (new people), one avatar. The 18 idle requests were mostly the member list re-reading the same data on every presence change: `ds_people_meta` ×4,
`profiles_public` ×4 (people the database does not return were asked again each time), `nick_extras` ×2, `season_levels` ×2,
`file_blocked` ×2, plus `dsm_forums`, `nick_fx`, `message_reactions`.

Logged-in user, from the timers in the code (not measurable headless without a real account):
- `comm_ping` («я на сайте», friends see you online; server window 3 min): was 1 / min → now 0.5 / min (and on route change / tab return).
- `notif` poll: 1 per 90 s (0.67 / min). Live badge (`ad_live` / stream status): 1 per 3 min.
- Friends app open: was 3 / min → now 2 / min, 0 while the tab is hidden.
- In a voice channel: `cv_ping` 2.4 / min (server window 75 s) + one `cv_check` per new neighbour.
- Presence (Realtime, not REST): track at most every 15 s and only on change. Typing: Realtime broadcast while typing.
- Messages: one insert per message (the server checks age, mute, slow mode, password, automod in the trigger — must stay).

## Done in T-169 (cheapest safe reductions)
1. `ds_people_meta`: the same people's statuses are not re-read for 60 s (ds-people.js `META_TTL`; status changes show within a minute).
2. `profiles` misses: ids the database does not return are not re-asked for 5 minutes (phone.js `profMiss`).
3. `comm_ping` every 2 min instead of every minute (phone.js `LOAD2`; still inside the 3-minute online window).
4. Friends app auto-refresh: 30 s instead of 20 s and none while the tab is hidden.
Rollback: `META_TTL = 0`, `LOAD2 = false`, the 20 s line in phone-apps.js.

## Next (a list, not done)
- Voice presence by Realtime presence on the signed topic instead of `cv_ping` polling: the server still counts the limit at
  `cv_pass` time; neighbours already verify the pass. Saves 2.4 req/min per person in voice. Needs care: the limit check uses
  `voice_here`, so the ping must stay at least for limited channels.
- `nick_extras` / `season_levels` / `file_blocked`: batch per page view and cache 5 min (same pattern as 1–2).
- Reactions: Realtime broadcast for the live update + one batched write per 2 s per user (server keeps the row and the rate limit).
- Message history: already paged by 50 (T-165); keep `content-visibility` and do not refetch on reconnect if the last id is known.
- `comm_ping` could ride on Realtime presence (the presence meta already carries the place); the server would read presence only
  if Supabase exposes it to SQL — it does not today, so the ping stays.
