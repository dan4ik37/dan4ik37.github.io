// T-131 (AI3D A2): the Backrooms clip pack. Generates the first batch of shared-skeleton clips (js/engine/skel.js) on the
// BaseBody_Male proportions and writes:
//   <out>/clips.csv            — Layer-1 metadata, one row per clip (action id, loop, root speed, foot plant/lift, blend…)
//   <tmp>/clips.json           — bones (T-pose heads), per-clip local rotations + Hips with ROOT MOTION baked (for Blender)
// then runs headless Blender (factory startup) on E:\d37-core\anim\tools\build_fbx.py → <out>/D37_Clips.fbx and
// check_fbx.py (re-import: bone names, clip lengths, foot slide re-measured) → <tmp>/check.json.
// Usage: node scripts/anim-pack.cjs [out=E:/d37-core/anim] [--no-blender]
// Env: BLENDER (default D:/Tools/Blender/blender.exe), D37_TMP (default E:/claude-tmp) → <D37_TMP>/t138/pack.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const S = require('../js/engine/skel.js');
const args = process.argv.slice(2), OUT = path.resolve(args.find(a => !a.startsWith('--')) || 'E:/d37-core/anim');
const TMP = path.join(process.env.D37_TMP || 'E:/claude-tmp', 't138', 'pack');
const BLENDER = process.env.BLENDER || 'D:/Tools/Blender/blender.exe';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

const sk = S.reference({ sex: 'm' });
const t0 = Date.now(), clips = S.batch(sk), genMs = Date.now() - t0;
const r6 = x => Math.round(x * 1e6) / 1e6;
const bones = S.BONES.map((b, i) => ({ id: b.id, parent: b.parent >= 0 ? S.BONES[b.parent].id : null, head: [0, 1, 2].map(c => r6(sk.rest[i * 3 + c])), req: b.req }));
const out = {
  contract: 'body.clips', version: S.VERSION, date: new Date().toISOString().slice(0, 10), generator: 'site js/engine/skel.js (T-131)',
  frame: 'meters; right-handed, Y up, character faces +Z, +X = character LEFT (glTF). Rest = T-pose, identity bone rotations.',
  skeleton: 'BaseBody_Male proportions (Backrooms), 1.80 m', bones, heel: sk.heel.map(v => v.map(r6)), ball: sk.ball.map(v => v.map(r6)),
  clips: clips.map(c => {
    // Hips with root motion baked (Unity extracts it: Root Transform Position XZ / Rotation not baked into pose)
    const n = c.n, q = [], hips = [];
    for (let i = 0; i < n; i++) {
      const yaw = c.root[i * 3 + 2], cy = Math.cos(yaw), sy = Math.sin(yaw), hx = c.p[i * 3], hy = c.p[i * 3 + 1], hz = c.p[i * 3 + 2];
      hips.push(r6(cx(c, i) + cy * hx + sy * hz), r6(hy), r6(c.root[i * 3 + 1] - sy * hx + cy * hz));
      const yq = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      for (let b = 0; b < S.NB; b++) {
        const k = (i * S.NB + b) * 4; let v = [c.q[k], c.q[k + 1], c.q[k + 2], c.q[k + 3]];
        if (b === 0 && !c.additive) v = S.q.mul(yq, v);
        q.push(...v.map(r6));
      }
    }
    return { name: c.name, action: c.action, variant: c.variant, fps: c.fps, frames: n - 1, dur: c.dur, loop: c.loop, additive: c.additive, pose: c.pose,
      speed: c.speed, heading: c.heading, contacts: c.contacts, slide: c.slide, q, hips };
  }),
};
function cx(c, i){ return c.root[i * 3]; }
fs.writeFileSync(path.join(TMP, 'clips.json'), JSON.stringify(out));
fs.writeFileSync(path.join(OUT, 'clips.csv'), S.csv(clips));
const worst = clips.reduce((m, c) => Math.max(m, c.slide.max), 0), wob = clips.reduce((m, c) => Math.max(m, c.slide.wob), 0);
console.log(`generated ${clips.length} clips in ${genMs} ms; foot slide max ${worst.toFixed(5)} m/s (key rate), wobble max ${wob} mm; clips.json ${(fs.statSync(path.join(TMP, 'clips.json')).size / 1e6).toFixed(2)} MB`);
for (const c of clips) console.log(`  ${c.name.padEnd(24)} ${c.dur.toFixed(3)} s ${String(c.fps).padStart(2)} fps ${c.loop ? 'loop' : '    '} ${c.additive ? 'add' : '   '} v ${c.speed.toFixed(2)} slide ${c.slide.max.toFixed(5)} wob ${c.slide.wob} mm`);
if (args.includes('--no-blender')) process.exit(0);

const tools = path.join(OUT, 'tools');
const run = (script, extra) => {
  const env = { ...process.env, TMP: TMP, TEMP: TMP };
  const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-noaudio', '--python', path.join(tools, script), '--', ...extra], { encoding: 'utf8', env, maxBuffer: 64e6 });
  const lines = (r.stdout + r.stderr).split(/\r?\n/).filter(l => /^(D37|Error|Traceback|  File|\w+Error)/.test(l));
  console.log(lines.join('\n'));
  if (r.status !== 0) { console.log('blender exit', r.status); process.exit(1); }
};
const t1 = Date.now();
run('build_fbx.py', [path.join(TMP, 'clips.json'), path.join(OUT, 'D37_Clips.fbx')]);
console.log(`FBX built in ${((Date.now() - t1) / 1000).toFixed(1)} s, ${(fs.statSync(path.join(OUT, 'D37_Clips.fbx')).size / 1e6).toFixed(2)} MB`);
const t2 = Date.now();
run('check_fbx.py', [path.join(OUT, 'D37_Clips.fbx'), path.join(OUT, 'clips.csv'), path.join(TMP, 'clips.json'), path.join(TMP, 'check.json')]);
console.log(`FBX checked in ${((Date.now() - t2) / 1000).toFixed(1)} s → ${path.join(TMP, 'check.json')}`);
const chk = JSON.parse(fs.readFileSync(path.join(TMP, 'check.json'), 'utf8'));
console.log(`check: ${chk.pass} ok, ${chk.fail} failed; slide max ${chk.slideMax} m/s`);
process.exit(chk.fail ? 1 : 0);
