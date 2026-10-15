// Бой «Набегов» для браузера: js/games/raid-sim.js — ТОТ ЖЕ код, что считает сервер (api/_lib/raid-sim.js, makeRaidSim.toString()).
// Поменял api/_lib/raid-sim.js → node scripts/make-raid-sim.mjs (и подними GAMES_VER в js/features/games.js).
// --check — только проверить, что копия свежая (так делает scripts/raid-test.cjs).
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const SITE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeRaidSim } = await import(pathToFileURL(path.join(SITE, 'api/_lib/raid-sim.js')).href);
const out = `// АВТОМАТИЧЕСКИ из api/_lib/raid-sim.js (node scripts/make-raid-sim.mjs) — руками не править: сервер считает бой этим же кодом.
(function(){
  var root = typeof window !== 'undefined' ? window : globalThis;
  var makeRaidSim = ${makeRaidSim.toString()};
  root.makeRaidSim = makeRaidSim;
  root.RaidSim = makeRaidSim();
})();
`.replace(/\r\n/g, '\n');   // концы строк — как в git (на Windows рабочая копия бывает с \r\n)
const file = path.join(SITE, 'js/games/raid-sim.js');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  const same = cur === out;
  console.log(same ? 'js/games/raid-sim.js — свежая копия боя' : 'js/games/raid-sim.js УСТАРЕЛ — node scripts/make-raid-sim.mjs');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, out);
console.log('js/games/raid-sim.js собран из api/_lib/raid-sim.js');
