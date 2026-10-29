# Свой сервер для игр сайта (T-045)

Сервер владельца в Oracle (бесплатный, ARM, 2 ядра, 12 ГБ) берёт на себя **онлайн-комнаты игр** (шахматы, карты, столы,
«Клеточки», «Червячки», «Крокодил», Unity-игры) и **TURN** — «посредника» для видеосвязи и игр, когда два телефона не могут
соединиться напрямую. Supabase остаётся для базы, входа и всего остального.

Зачем: у бесплатного Supabase на весь сайт — 200 соединений, 100 сообщений в секунду, 20 сообщений присутствия в секунду и
5 обновлений присутствия за 30 с на человека. Свой сервер этих пределов не имеет: проверено 1000 игроков в 100 комнатах, каждый шлёт
10 сообщений в секунду (это очень много — обычно 2–4), — одно ядро процессора и ~150 МБ памяти, задержка в среднем 0,04 с.

Главное правило: **если сервер выключен, недоступен или до него плохая связь — сайт сам работает через Supabase, как раньше.**
Комната никогда не делится «половина там, половина тут»: сервер сам следит за этим и, если надо, переводит всю комнату в Supabase.

---

## Часть 1. Для владельца — по шагам

Два окна:
- **Windows** — PowerShell на твоём компьютере, строка начинается с `PS C:\Users\…>`;
- **Сервер** — то же окно после входа по SSH (как для Майнкрафта), строка начинается с `ubuntu@…:~$`.

Каждая команда — отдельно: скопировал один блок → вставил → Enter → дождался. Пароли и ключи никуда не вставлять и никому не
присылать: секреты сервер придумывает сам (шаг 4) и хранит у себя.

Майнкрафт (порт 25565) и бот Discord не трогаем: у нашего сервера свои порты и ограничения памяти (вместе ≤ 1 ГБ).

### Шаг 0. Узнать публичный IP сервера

Oracle Cloud → ☰ → **Compute → Instances** → твой сервер → **Public IP address**, например `203.0.113.7` (дальше вместо
`203.0.113.7` везде пиши свой).

### Шаг 1. Открыть порты в Oracle (Security List)

Oracle Cloud → ☰ → **Networking → Virtual Cloud Networks** → твоя сеть → слева **Security Lists** → **Default Security List…**
→ **Add Ingress Rules**. Добавить 5 правил (у каждого: **Source CIDR** `0.0.0.0/0`, **Source Port Range** — пусто, то есть
**All**):

| IP Protocol | Destination Port Range | зачем |
|---|---|---|
| TCP | `80` | выдача сертификата HTTPS (Let's Encrypt проверяет по нему) |
| TCP | `443` | сам сервер игр (https://IP) |
| UDP | `3478` | TURN |
| TCP | `3478` | TURN (если UDP закрыт у провайдера игрока) |
| UDP | `49160-49200` | TURN — пересылка |

### Шаг 2. Открыть те же порты на самом сервере (iptables)

На образах Oracle Ubuntu фаервол — iptables (файл /etc/iptables/rules.v4), ufw нет (29.10.2026: `sudo: ufw: command not found`).
Правила разрешений должны стоять ДО строки `-A INPUT -j REJECT`. Так сделано на сервере владельца 29.10.2026:

**Сервер** — открыть сейчас:
```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 3478 -j ACCEPT && sudo iptables -I INPUT 6 -p udp --dport 3478 -j ACCEPT && sudo iptables -I INPUT 6 -p udp --dport 49160:49200 -j ACCEPT
```
Сохранить на после перезагрузки: те же 5 строк — в /etc/iptables/rules.v4 сразу после строки с `--dport 22` (копия файла —
rules.v4.bak), проверка `sudo iptables-restore --test /etc/iptables/rules.v4`. Номер строки смотреть заранее:
`sudo grep -n "INPUT" /etc/iptables/rules.v4` (одна вставка `sed -i -e '<N>a …'` на каждую строку; у владельца N = 43).

Памяти мало (Майнкрафт 8 ГБ из 12): добавлен файл подкачки 2 ГБ (/swapfile, в /etc/fstab) — чтобы сборка и пики не выбили Майнкрафт.

### Шаг 3. Скачать на сервер только папку `server/` с сайта

**Сервер:**
```bash
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/dan4ik37/dan4ik37.github.io.git d37
```
```bash
cd ~/d37 && git sparse-checkout set --no-cone /server/ && git checkout main
```
Проверка — должны быть `Caddyfile`, `docker-compose.yml`, `make-env.sh`, папки `rt` и `coturn`:
```bash
ls ~/d37/server
```

### Шаг 4. Создать файл настроек с секретами (одна команда)

**Сервер** (вместо `203.0.113.7` — твой IP):
```bash
cd ~/d37/server && bash make-env.sh 203.0.113.7
```
Должно написать «Готово: .env создан…». Секреты (пароль TURN и ключ для метрик) придуманы случайно прямо на сервере и лежат в
`~/d37/server/.env`. Этот файл **не показывать, не копировать, не присылать** — он нужен только серверу.

### Шаг 5. Запустить

**Сервер** (первый раз — 2–5 минут: скачиваются образы и собирается наш сервер):
```bash
cd ~/d37/server && docker compose up -d --build
```
Проверка — у трёх строк `d37-rt-1`, `d37-caddy-1`, `d37-turn-1` должно быть `Up` (у rt через полминуты — `healthy`):
```bash
docker compose ps
```

### Шаг 6. Проверить с Windows

Открой в браузере: `https://203.0.113.7/health` — должно показать что-то вроде
`{"ok":true,"rooms":true,"v":"1.0.0",…}`. Замок в адресной строке — без предупреждений (сертификат Let's Encrypt на IP; первый
раз выдаётся за 10–60 секунд после запуска).

Или **Windows**:
```powershell
Invoke-RestMethod https://203.0.113.7/health
```

### Шаг 7. Включить на сайте

Напиши главному: «сервер запущен, IP 203.0.113.7». Он впишет в `js/core/config.js` `RT_URL = 'https://203.0.113.7'` и выложит
сайт. Можно включать постепенно: `RT_SHARE = 0.2` — через сервер пойдёт каждая пятая комната (все игроки одной комнаты — вместе).

### Как смотреть, что происходит

**Сервер** — сводка (соединения, комнаты, сообщения в секунду, память, процессор):
```bash
cd ~/d37/server && docker compose exec rt node src/cli.js metrics
```
Свободная память и нагрузка всего сервера:
```bash
free -h
```
```bash
docker stats --no-stream
```
Журнал нашего сервера (последние 50 строк; адресов посетителей там нет):
```bash
docker compose logs --tail 50 rt
```
Журнал HTTPS (если сертификат не выдаётся — причина здесь):
```bash
docker compose logs --tail 50 caddy
```

### Обновить (когда главный скажет «обнови сервер»)

**Сервер:**
```bash
cd ~/d37/server && git pull && docker compose up -d --build
```
Во время перезапуска (секунды) игры сами переподключаются или уходят в Supabase — партии не обрываются.

### Если что-то пошло не так — откат

1. Проще всего: попросить главного вернуть `RT_URL = ''` — сайт снова целиком на Supabase (как до этой задачи).
2. Остановить сервер (сайт сам уйдёт в Supabase за ~5 секунд):
   ```bash
   cd ~/d37/server && docker compose down
   ```
3. «Обслуживание» (сервер работает, но сайт его не использует): добавить строку и перезапустить:
   ```bash
   cd ~/d37/server && echo "MAINTENANCE=1" >> .env && docker compose up -d
   ```
   Вернуть: удалить эту строку (`nano .env`) и снова `docker compose up -d`.

### Частые вопросы

- **Сертификат не выдаётся** (`caddy` пишет про challenge/timeout) — закрыт порт 80 (шаг 1 или 2). Открыть и
  `docker compose restart caddy`.
- **`/health` не открывается** — проверь шаг 1 (443/TCP в Oracle) и шаг 2 (`sudo ufw status`), потом `docker compose ps`.
- **Сменился IP сервера** — `bash make-env.sh <новый IP>` (секреты останутся), `docker compose up -d`, и сказать главному.
- **Домен вместо IP** (DuckDNS или купленный) — направить домен на IP, в `.env` заменить строку `RT_HOST=…` на домен,
  `docker compose up -d`, главный поменяет `RT_URL`.
- **Майнкрафт тормозит?** — наш сервер ограничен: rt ≤ 512 МБ и 1 ядро, Caddy ≤ 256 МБ и ½ ядра, TURN ≤ 256 МБ и ½ ядра.
  `docker stats --no-stream` покажет, кто сколько ест.
- **Трафик**: Oracle бесплатно отдаёт 10 ТБ в месяц. 100 игроков, играющих круглые сутки, — до 2 ТБ в месяц; на деле меньше.
  Сколько сейчас — строка «трафик» в `metrics`.

---

## Part 2. For agents (English)

### Architecture

```
browser tab ──wss://HOST/rt──► Caddy :443 (TLS, Let's Encrypt IP cert «shortlived», default_sni) ──► rt 127.0.0.1:8787 (Node 22 + ws)
            ──https://HOST/health, /turn──────────────────────────────────────────────────────────┘        │  watcher: 1–8 sockets
            ──turn:HOST:3478 (udp/tcp) ─► coturn (host network, relay 49160–49200/udp)                     ▼  (Phoenix vsn 1.0.0)
            ──(fallback) wss://<project>.supabase.co/realtime ◄───────────────── Supabase Realtime ◄──────┘
```
All three containers use `network_mode: host` (like the owner's Minecraft): no Docker NAT, Caddy sees real client IPs and
passes them as `X-Forwarded-For` (rt trusts it only from loopback), rt listens on 127.0.0.1 only. Secrets: `server/.env`
(make-env.sh, openssl, chmod 600, gitignored); coturn gets its secret through a config file written inside the container (not argv).

Files: `server/rt/src/` — `server.js` (HTTP + upgrade + limits + timers), `hub.js` (rooms/presence/broadcast/resume), `audit.js` (anti-cheat feed),
`sbwatch.js` (Supabase watcher), `jwt.js` (JWKS ES256/RS256), `turn.js`, `config.js` (all env knobs), `cli.js`;
`server/docker-compose.yml`, `server/Caddyfile`, `server/coturn/turnserver.conf` (only options verified against coturn 4.18.0
source — an unknown option or a malformed `denied-peer-ip` stops coturn). Client: `js/core/rt.js` (D37RT). Hooks (stage 1):
`GameRoom.channel` (room.js — so table.js, versus, cities, krokodil, unity-host too), `IoKit.supaTransport` (iokit.js),
`NetPlay` ICE (netplay.js); calls.js unchanged — D37RT keeps `window.D37_TURN` fresh (prefetch on `d37:callstate`).

### Protocol v1 (JSON text frames, one WebSocket per tab, channels multiplexed)

Client → server (`q` — per-connection sequence on room messages; after a resume the client re-sends what the server hasn't seen):
- `{t:'hi', v:1, sid?, pb?}` — first frame (5 s); `sid` — resume; `pb` — probe size (40000).
- `{t:'j', i, c:name, k?:presenceKey, s:0|1 (self), p:0|1 (presence), q}` — join; `i` — client channel id.
- `{t:'l', i, q}` · `{t:'b', i, e:event, p:payload, q}` · `{t:'tr', i, m:meta, r:ref, q}` · `{t:'ut', i, r, q}` · `{t:'ping', n}` · `{t:'auth', jwt}`.

Server → client (`r` in room frames = global room number — identical bytes for every member, built once per broadcast):
- `{t:'hi', sid, resumed, q:lastSeen, v, grace}` then `{t:'pr', d:'…'}` (probe) then (resume) everything missed while away.
- `{t:'j', i, r, home:'rt', k}` | `{t:'j', i, home:'sb'}` (room lives on Supabase) | `{t:'j', i, e:'name'|'key'|'dup'|'limit'|'full'|'busy'}`.
- `{t:'ps', r, s:{key:{metas:[{phx_ref,…meta}]}}}` · `{t:'pd', r, j:{…}, l:{…}}` — Phoenix shapes (same as Supabase: re-track =
  joins with `phx_ref_prev` + leaves); `{t:'b', r, e, p}` · `{t:'ok', r, e?}` · `{t:'pong', n, q}` · `{t:'mv', r}` (move this room
  to Supabase) · `{t:'auth', ok}` · `{t:'bye', e:'restart'|'rate'|'bad'|'maintenance'}`. Close codes: 4001 no hi, 4008 flood,
  4009 garbage, 1009 too big, 1012 restart.
- Presence meta: the server strips `_v`/`phx_ref*` and stamps `_v: 1` when the presence key equals the tab's verified account id
  (`auth` → JWKS of the Supabase project, no secret; also re-stamps metas tracked before auth). Guests have no `_v`.

### Transport rules (never split a room)

1. RT_URL empty → `D37RT.client()` is null → hooks use sbClient exactly as before (rt-test 8f: zero requests).
2. First room of a session: `/health` (ok, rooms, proto 1; cached 30 min) → socket → **probe 40 KB** in one frame (Russian ISPs
   cut connections to foreign hosting after ~16 KB — Cloudflare reported it from 2025-06-09 for its edge; similar reports for other
   Western hosts). No probe in 8 s → `bad: stall` for 15 min (sessionStorage) → whole session on Supabase. A socket that dies by
   heartbeat twice in 3 min → same (late throttling, rt-test 8c'). A room join never waits more than 2.5 s for the probe: it
   goes to Supabase and the server's watcher pulls the others there if needed (8c''). Warm-up on entering `#/games…`.
3. **Watcher** (sbwatch.js): for every room with presence the server joins the room's Supabase channel without tracking (no traffic
   unless somebody is there). At creation (peek, ≤ 1.5 s): somebody on Supabase → `home:'sb'`. Later somebody appears there (blocked
   tab, old cached tab, `?rt=0`) → `mv` to all members of the room **and its `<room>-…` siblings** (io relay `-r`), the name is
   remembered 10 min → new joins `home:'sb'`. Watcher down > 30 s → `/health rooms:false` → new sessions use Supabase.
4. Client stickiness: a family (`name` without `-r`) that moved stays on Supabase while any channel of it is open + 30 s.
5. Server down: reconnect with the same `sid` (0 / 0.4 / 1 / 2 / 3 s + jitter); the server keeps members 10 s (`GRACE_MS`) and
   buffers what they miss (512 frames / 1 MB), the client re-sends unacknowledged frames (outbox, ack in pong/hi). Not back in 5 s
   (9 s after `bye restart`) → every RT channel moves to Supabase, RT is skipped for new rooms for 60 s.
6. Every move/rejoin **holds presence** (presenceState() returns the snapshot, join/leave/sync are not emitted) until all previous
   keys are back or 5 s; then synthesized join/leave + one sync only if something really changed. Status `SUBSCRIBED` is never
   re-emitted on a transport switch (table.js regenerates ECDH keys on SUBSCRIBED); the wrapper re-tracks the last meta itself.
7. `?rt=0` — Supabase only in this tab (sessionStorage; `?rt=1` undoes). Dev: `localStorage.d37_rt_url` works only on localhost.
   `RT_SHARE` (0…1) — share of rooms by FNV hash of the family name (all members decide the same).

### Limits (server/rt/src/config.js, env) — defaults

Connections 4000 total, 64 per address (schools/CGNAT), 30 new per address burst + 1/s; 32 channels per connection; frame 256 KB
(= Supabase Free); 120 msgs burst + 60/s and 4 MB burst + 1 MB/s in per connection, and what one connection makes the server
send (frame × recipients) 8 MB burst + 2 MB/s — a «Кубомир» host relaying 46 KB bundles to 4 guests fits (drops; 400 drops in 10 s → kicked); 300
subscribers and 200 presences per room; meta 4 KB; track 10 burst + 1/s per member; 20 000 rooms; memory: > 380 MB RSS — no new
sockets/rooms and slow readers get nothing above 32 KB buffered, > 450 MB — /health ok:false and readers above 64 KB are
disconnected (container 512 MB, `--max-old-space-size=320`); slow reader normally: > 1 MB buffered — drop, > 4 MB — disconnect;
buffers of disconnected sessions ≤ 512 frames / 1 MB each and 64 MB together; /turn 10 burst + 1/min per address, TTL 1 h; coturn: 12 allocations per user, 300 total, 96 KB/s per
session, 6 MB/s total, private/loopback/link-local (169.254.169.254)/CGNAT/doc/multicast peers denied (IPv4 + IPv6).

### Tests and numbers (22.10.2026, i5-12400F Windows, the machine at ~90–100 % CPU from other work)

- `scripts/rt-test.cjs` — 144 checks, ~47 s: protocol, Phoenix shapes vs real supabase-js 2.117.2 (same file the site loads) and
  the presence algorithm vs `@supabase/phoenix` Presence on 2400 random steps, limits, fuzz (1500 random frames + 30 000-deep nesting:
  0 internal errors),
  resume without loss both ways, a stalled reader (others get everything, server memory +<40 MB for 9 MB sent), JWT (7 bad tokens rejected), watcher (peek, move with `-r`, reconnect), room.js / table.js / IoKit
  through D37RT incl. `?rt=0` move, server killed mid-game, network blip (resumed), «16 KB» proxy, late throttling, slow probe,
  RT_URL empty (0 requests), TURN, 20 join/leave cycles (server 0 rooms/members, client 0 channels/refs, timers not growing).
- `scripts/rt-load-test.cjs` (`--quick` in ci-run, optional) — 1000 connections, 100 rooms × 10, 10 msg/s each (`--prio`):
  9.2 k msgs/s in, 83 k/s out (98 Mbit/s), server CPU 84–88 % of one core, event-loop p99 40 ms (Windows timer floor ~31 ms),
  delivery p50 38 ms / p90 84 / p99 128 / max 150 ms, delivered 100 %, RSS 70 → 92 MB with 1000 idle sockets (≈ 22 MB per 1000),
  150 MB busy; reconnect storm 500 with resume — all back in 0.1 s, 500 fresh — all back in 0.9 s (152 needed one retry).
  Before the per-tick cork (one write per socket per loop turn) writev took ~45 % of the time and p99 was seconds.
- Soak, 12 min each: `rt-load-test.cjs --conns 300 --rooms 30 --rate 4 --soak 720` — 8395 room changes, 348 dropped sockets
  (all resumed), 833 k msgs sent / 8.28 M delivered, 0 errors, 0 internal, p50 16.5 / p99 35.8 ms, CPU 8–17 % of a core, heap
  9–32 MB and RSS 93–135 MB as a GC sawtooth (back to 93 MB twice — no growth), end: 300 conns / 300 members / 0 zombies.
  `rt-test.cjs --soak 720` — 4 vm tabs with real supabase-js, game after game, the server killed **mid-game** every 2 min and back
  after 10 s: 1557 games, 5 kills, 31 140 / 31 140 moves delivered (1436 rooms via the server, 1678 via the Supabase fallback),
  client heap 13–33 MB as a GC sawtooth (back to ~15 after each GC), 0 channels / 0 server members at the end, timers 4 → 1
  (idle sockets closed; it was 4 → 16 before the auth timer was tied to the socket), 0 console errors.
- `scripts/rt-e2e.cjs` (`--e2e`) — 18 checks, ~35 s: two Chrome processes, real Supabase: «Клеточки» host + guest and a
  table.js table through the server; /turn from the page (CORS), `D37RT.ice()`, `window.D37_TURN`; server killed → both tabs on
  Supabase in 2.5–2.9 s, roles kept, no «Нет связи», guest keeps getting snapshots, table seats never dropped below 2, private
  message after the move delivered; `?rt=0`. Phone profile (CPU ×4): rt.js eval 0.15 ms, a room message 3.6 µs (supabase-js
  6.1 µs, ratio 0.66 measured interleaved), a presence diff in a 10-person room 23 µs.

### Anti-cheat feed (hook for T-073; `server/rt/src/audit.js`, OFF by default)

Owner (22.10): «античит, который другая система проверяет, а не сам сервер». The relay only **writes a journal**; a separate
checker (T-073) reads it later and decides. The relay never waits for the checker; with `AUDIT` empty nothing is collected
(one `if` per event). Enable in `server/.env`, then `docker compose up -d`:

| env | meaning (default) |
|---|---|
| `AUDIT` | `''` off · `file` — rotating `audit.N.ndjson` in the `rt_audit` volume (`/audit`) · `http` — POST batches to `AUDIT_URL` |
| `AUDIT_DIR`, `AUDIT_FILE_MB`, `AUDIT_FILES` | `/audit`, 50 MB per file, 5 files (`audit.0.ndjson` is the newest) |
| `AUDIT_URL`, `AUDIT_TOKEN` | internal consumer, e.g. `http://127.0.0.1:9090/feed`; body NDJSON, `Authorization: Bearer AUDIT_TOKEN` |
| `AUDIT_SALT` | salt of all hashes (set it — `openssl rand -hex 16` into .env — to correlate across restarts; else random per process) |
| `AUDIT_EVENTS` | server-side «auditable» events: `room-pattern:event|event,…` (`*` wildcard), e.g. `kletochki-io-*:in,chess-duel-*:m` |
| `AUDIT_PER_SEC`, `AUDIT_ROOM_PER_SEC` | caps: 2000 records/s overall, 100/s per room (beyond — dropped and counted) |
| `AUDIT_PAYLOAD`, `AUDIT_QUEUE`, `AUDIT_STAT_MS` | 2048 bytes per recorded payload (bigger → `cut: 1`, no payload), 20 000 queued, `stat` every 10 s |

A game marks its deterministic inputs as auditable in the channel config — `GameRoom.channel(name, { config: { …, audit:
{ events: ['in'] } } })` (D37RT sends it in the join, ≤ 8 names); the room's set is the **union** over its members plus
`AUDIT_EVENTS`, so a cheater who doesn't declare is still recorded. Never mark chat or anything carrying names/text.

Records (one JSON object per line; `q` — sequence per process, `t` — ms epoch, `ch` — channel name, `r` — room number, `m` —
member hash (salted SHA-256 of the presence key, 12 chars), `c` — session hash, `u` — verified-account hash):
- `{ev:'join', ch, r, m, c, u?, pr}` · `{ev:'leave', ch, r, m, why:'leave'|'gone'|'move', sent}` · `{ev:'kick', ch, r, m, why}`
- `{ev:'b', ch, r, m, e, n, p?, cut?}` — broadcast: event, frame bytes, payload (JSON text) only for auditable events
- `{ev:'tr', ch, r, m, n, v?}` (presence size only — metas are never written) · `{ev:'ut', ch, r, m}` · `{ev:'mv', ch, r, n}`
- `{ev:'stat', written, dropRate, dropRoom, dropQueue, cut, sinkErrors, …}` — deltas since the previous stat: the checker knows
  where the journal has gaps. Delivery is best-effort, at-most-once; no addresses, no raw ids, no metas, no other payloads.
Tested in rt-test («журнал»: hashes only, payload only for declared/server events, room cap with counted drops, HTTP sink with
token, off by default). Cost at 500 conns × 10 msg/s with every message auditable: server CPU 45 → 54 % of a core, latency same.

### Stage 2 — mechanical swaps (not done in T-045)

`D37RT.channel(name, opts)` / `D37RT.removeChannel(ch)` / `D37RT.getChannels()` / `ch.topic` mirror supabase-js; channels with
`postgres_changes` bindings are routed to Supabase automatically, `system` bindings are attached on the Supabase path only.
1. **mir.js / world.js** (`mir-<N>`, `world-<N>`): replace `sbClient.channel(` → `(window.D37RT?.client?.() || sbClient).channel(`,
   `sbClient.removeChannel(` / `getChannels(` likewise; drop the presence rate gate (`presGate`) when on RT (D37RT allows 1/s);
   the world pass (world_pass / world_check ECDSA) can later rely on `_v` for logged-in players. **mir-war.js**, **worldchat.js**
   (`mir-all`, broadcast-only — give it a presence-less sibling rule or move with `mir-<N>`).
2. **chat.js `online-users`** (every page, thousands of keys): do not mirror 1:1 (O(N²) diffs). Add a server-side «aggregate
   presence» mode: counts + only the keys a tab asks for (friends), diffs batched every 2 s. Then browsers that don't open the
   chat or Supabase tables need no Supabase realtime socket — that removes the 200-connection cap.
3. **calls.js** signaling (`call-…`, presence + signed broadcasts) and **typing** channels (`typing-o-*`, `typ-*`, broadcast-only):
   swap the client object; typing channels are presence-less — watcher can't see them, so open them next to a presence channel
   of the same family or accept that typing indicators may split (harmless).
4. **Server-side postgres_changes fan-out**: one service connection per table (messages, community_messages, direct_messages,
   notifications) on the server; route rows to sockets by channel subscription and, for private tables, by the verified uid
   (`auth` already verifies JWTs). Needs the service-role key on the server (env, owner enters it) and an allowlist of
   (table, filter, rule) mirroring RLS.
5. **Studio 3D** (`js/engine/net-transport.js`, D37E.net.room) — its own transport over Supabase; give it a D37RT branch.
6. **Cloud saves** («Кубомир», «Подземье», studio worlds): `PUT/GET /save/<game>/<slot>` with JWT, gzip, quotas (e.g. 3 × 5 MB,
   VIP more) on an attached block volume (Always Free: 200 GB total across boot + block volumes), nightly copy to the owner's PC.
7. **Discord bot (T-046)** on the same VM: a separate service in its own compose (mem_limit ~300m), talks to the site through
   Supabase or a small authenticated endpoint on rt (`/bot`, ADMIN_TOKEN-like secret in .env).
8. **Scaling past one core**: shard rooms over 2 rt processes (two upstreams in Caddy on two paths `/rt` and `/rt2`); D37RT maps a
   room family hash → shard socket. Faster relays for io-games/netplay when on RT (they still pace themselves for Supabase: 4–5/s).
