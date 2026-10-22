'use strict';
// For the owner, inside the container (the admin token never leaves the server):
//   docker compose exec rt node src/cli.js health    — the same as https://<IP>/health
//   docker compose exec rt node src/cli.js metrics   — connections, rooms, messages per second, memory, CPU, the Supabase watcher
const C = require('./config');
const what = process.argv[2] || 'metrics';
const url = `http://127.0.0.1:${C.PORT}/${what === 'health' ? 'health' : 'metrics'}`;
const headers = what === 'health' ? {} : { Authorization: 'Bearer ' + C.ADMIN_TOKEN };
fetch(url, { headers }).then(r => r.json()).then(j => {
  if (what === 'health') { console.log(JSON.stringify(j, null, 2)); return; }
  if (j.error) { console.log('Нет доступа к /metrics (ADMIN_TOKEN в .env?):', j.error); process.exitCode = 1; return; }
  const c = j.counts || {}, p = j.perSec || {}, w = j.watcher || {};
  console.log(`d37-rt ${j.v}, работает ${Math.round(j.up / 60)} мин`);
  console.log(`  соединений: ${c.conns} (ждут переподключения: ${c.zombies}), комнат: ${c.rooms}, мест в комнатах: ${c.members}, presence: ${c.presence}`);
  console.log(`  сообщений в секунду: принято ${p.msgIn}, отправлено ${p.msgOut}; трафик: ${Math.round((p.bytesIn || 0) / 1024)} / ${Math.round((p.bytesOut || 0) / 1024)} КБ/с`);
  console.log(`  память: ${j.mem?.rssMb} МБ${j.mem?.soft ? ' (МНОГО — новые не принимаем)' : ''}, процессор: ${j.cpuPct}% одного ядра, задержка цикла p99: ${j.loopMs?.p99} мс`);
  console.log(`  Supabase-наблюдатель: сокетов ${w.up}/${w.sockets}, каналов ${w.topics}, комнат переведено в Supabase: ${j.stats?.moves}`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(j, null, 2));
}).catch(e => { console.log('Сервер не отвечает на 127.0.0.1:' + C.PORT + ' —', e.message); process.exitCode = 1; });
