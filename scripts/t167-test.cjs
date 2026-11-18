// T-167: быстрые проверки в node — разбор картинок и внутренних адресов (api/_lib/routes/ds2.js), инварианты community.sql ч. 15
// (хеш пароля — не в таблице каналов, лимит голосового решает сервер, гранты), флаги клиента (картинки сообществ выключены).
// Запуск из корня сайта: node scripts/t167-test.cjs
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
(async () => {
  const m = await import(pathToFileURL(path.join(SITE, 'api/_lib/routes/ds2.js')).href);
  const png = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(64, 16); png.writeUInt32BE(48, 20);
  t(JSON.stringify(m.sniffImage(png)) === JSON.stringify({ mime: 'image/png', w: 64, h: 48 }), 'PNG size', m.sniffImage(png));
  const gif = Buffer.alloc(32); gif.write('GIF89a', 0); gif.writeUInt16LE(100, 6); gif.writeUInt16LE(50, 8);
  t(m.sniffImage(gif)?.w === 100 && m.sniffImage(gif)?.h === 50, 'GIF size');
  const webp = Buffer.alloc(32); webp.write('RIFF', 0); webp.write('WEBPVP8X', 8); webp.writeUIntLE(127, 24, 3); webp.writeUIntLE(63, 27, 3);
  t(m.sniffImage(webp)?.w === 128 && m.sniffImage(webp)?.h === 64 && m.sniffImage(webp).mime === 'image/webp', 'WebP VP8X size', m.sniffImage(webp));
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  t(m.sniffImage(jpg)?.w === 64 && m.sniffImage(jpg)?.h === 32, 'JPEG size', m.sniffImage(jpg));
  t(m.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10"></svg>')) === null, 'SVG refused');
  t(m.sniffImage(Buffer.from('<!doctype html><html><script>alert(1)</script>')) === null, 'HTML refused');
  t(m.sniffImage(Buffer.alloc(10)) === null, 'too short');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
    t(m.privateIp(ip), 'private ' + ip);
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111']) t(!m.privateIp(ip), 'public ' + ip);
  t(m.EXT_LIM.emoji.px <= 256 && m.EXT_LIM.sticker.bytes <= 512 * 1024, 'limits small');
  // TURN без ключей — выключено
  delete process.env.CF_TURN_KEY_ID; delete process.env.CF_TURN_KEY_TOKEN;
  let out = null; const res = { setHeader(){}, status(c){ this.c = c; return this; }, json(j){ out = j; return this; } };
  await m.turnCred({ headers: {} }, res); t(res.c === 200 && out?.off === true, 'turn-cred off without env', out);

  const sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'), p15 = sql.slice(sql.indexOf('-- ═══ часть 15 (ds2)'));
  t(p15.length > 1000, 'part 15 present');
  t(!/pw_hash/.test(p15) && /create table if not exists public\.chan_pw \(/.test(p15) && /revoke all on public\.chan_pw from anon, authenticated/.test(p15), 'password hash in a private table');
  t(/extensions\.crypt\(v, extensions\.gen_salt\('bf'/.test(p15), 'bcrypt (pgcrypto) for passwords');
  t(/as restrictive for select using \(public\.cm_chan_pw_ok\(channel_id\)\)/.test(p15) && /create trigger chan_pw_guard before insert on public\.community_messages/.test(p15), 'password: RLS read + trigger write');
  t(/reason', 'full'/.test(p15) && /voice_here where channel_id = p_channel and user_id = v_uid and seen_at > now\(\) - interval '75 seconds'/.test(p15), 'voice limit decided by server; neighbours admit only listed');
  t(/'voice_cap', 6, 2, 50/.test(p15) && /'comm_member_cap', 500/.test(p15), 'defaults: voice cap 6, member cap 500 (as before)');
  t(/grant execute on function public\.cf_ext_verified\([^)]*\) to service_role/.test(p15) && /'ext_media', 'off'/.test(p15), 'ext pictures: off by default, verified only by service');
  t(/return false;   -- до 13 и «возраст не указан» — никогда/.test(p15), 'camera never for under-13 / unknown');
  // клиент
  const fun = fs.readFileSync(path.join(SITE, 'js/features/ds-fun.js'), 'utf8');
  t(/const EXT_PICS = false;/.test(fun), 'ext pictures flag OFF in client');
  t(/credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'/.test(fun) && /digest\('SHA-256'/.test(fun), 'client: no cookies / redirects / referrer, sha-256 check');
  const calls = fs.readFileSync(path.join(SITE, 'js/features/calls.js'), 'utf8');
  t(/const DEVCHECK = true, CAM_ON = true, NETFIX = true, VLIMIT = true, UVOL = true;/.test(calls), 'calls flags present');
  t(/vt\.direction = R\.camOk \? 'sendrecv' : 'inactive'/.test(calls), 'kid: video transceiver inactive (neither sends nor receives)');
  const pages = fs.readFileSync(path.join(SITE, 'api/pages.js'), 'utf8'), vj = JSON.parse(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8'));
  t(/turncred: turnCred, extcheck: extCheck/.test(pages) && vj.rewrites.some(r => r.source === '/api/turn-cred') && vj.rewrites.some(r => r.source === '/api/ext-check'), 'routes wired (no new function)');
  t(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'Vercel functions ≤ 12');
  console.log(`t167-test: ${n - bad}/${n} ok`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
