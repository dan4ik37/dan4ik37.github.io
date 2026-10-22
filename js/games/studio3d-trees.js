// ═══════════════════════════════════════
//  «Студия 3D» — «🌳 Деревья» (T-022b): породы движка деревьев (js/engine/trees.js, trees3d.js) в «➕ Деталь» и «🌳 Предметы»;
//  в свойствах — порода, размер и «🎲 Другое дерево» (новое зерно: та же порода, другая форма)
// ═══════════════════════════════════════
// Расширение студии (D37E.studioExt, без правок studio3d.js). Дерево — объект Prefab с kind 'tree_<порода>': рисует общий предмет
// движка E.prefabs (trees3d.js — грузится и у игроков чужого мира: там расширения не подключаются, а дерево видно); форма — по
// зерну объекта (seed — после «🎲», иначе id: перенёс — та же форма), у гостей сети — так же (seed — в NET_EXTRA студии).
(() => {
  const E = window.D37E = window.D37E || {};
  const TR = () => E.trees;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = () => (TR()?.LIST || []).map(k => [k, TR().SPECIES[k].title, TR().SPECIES[k].icon]);
  const isTree = o => !!o && o.cls === 'Prefab' && typeof o.kind === 'string' && o.kind.startsWith('tree_') && !!TR()?.SPECIES[o.kind.slice(5)];
  let api = null;
  const ext = {
    id: 'trees',
    mount(a){ api = a; },
    unmount(){ api = null; },
    // меню: «➕ Деталь» и «🌳 Предметы» — группа «🌳 Деревья»
    menuHtml(html, kind){
      if (kind !== 'part' && kind !== 'prefab') return undefined;
      return html + '<div class="s3-mh">🌳 Деревья</div>' + list().map(([k, n, i]) => `<button type="button" data-m="tree:${esc(k)}">${esc(i)} ${esc(n)}</button>`).join('');
    },
    menu(a){
      if (typeof a !== 'string' || !a.startsWith('tree:')) return false;
      const k = a.slice(5), S = TR()?.SPECIES[k];
      if (S && api) api.insert('Prefab', { kind: 'tree_' + k, name: S.title });
      return true;
    },
    icon(ic, o){ return isTree(o) ? TR().SPECIES[o.kind.slice(5)].icon : undefined; },
    // свойства: порода (вместо списка предметов), размер, «🎲 Другое дерево»
    propsHtml(h, o){
      if (!isTree(o)) return undefined;
      const sel = `<label class="s3-lbl">Порода<select data-p="kind">${list().map(([k, n, i]) => `<option value="tree_${esc(k)}"${o.kind === 'tree_' + k ? ' selected' : ''}>${esc(i)} ${esc(n)}</option>`).join('')}</select></label>`
        + `<label class="s3-lbl">Размер <b>${esc(o.scale ?? 1)}</b><input type="range" min="0.4" max="2.5" step="0.1" value="${esc(o.scale ?? 1)}" data-p="scale"></label>`
        + `<button type="button" class="s3-btn" data-a="tree:reseed" title="Та же порода, другая форма">🎲 Другое дерево</button>`;
      return h.replace(/<label class="s3-lbl">Вид<select data-p="kind">[\s\S]*?<\/select><\/label>/, sel);
    },
    act(a){
      if (a !== 'tree:reseed') return false;
      const ed = api?.ed, o = ed?.sel;
      if (!isTree(o)) return true;
      api.pushHist();
      ed.SC.set(o, 'seed', (Math.random() * 4294967295) >>> 0);   // новое зерно — сохраняется с миром (и гостям)
      ed.SC.set(o, 'kind', o.kind);   // пересобрать
      api.markDirty(); api.refresh();
      return true;
    },
  };
  (E.studioExt = E.studioExt || []).push(ext);
})();
