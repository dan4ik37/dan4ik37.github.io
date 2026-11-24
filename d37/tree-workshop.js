export function treeWorkshop(run) {
  const panel = document.getElementById('tree-workshop');
  const form = panel.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const status = form.querySelector('output');
  const lod = Array.from(form.querySelectorAll('[data-level]'));
  const selected = () => Number(lod.find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.level || 0);
  const setLevel = level => lod.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === level)));
  const values = () => ({
    species: field('species').value,
    seed: Number(field('seed').value),
    height: Number(field('height').value),
    radius: Number(field('radius').value),
    crown: Number(field('crown').value),
    lod: selected(),
  });
  let specimen = false;

  function generate() {
    if (!form.reportValidity()) return false;
    const { species, seed, height, radius, crown, lod } = values();
    const result = run('game forests preview ' + [species, seed, height, radius, lod, crown].join(' '));
    specimen = result.startsWith('ок:');
    status.value = specimen ? 'Образец обновлён · LOD ' + lod : result;
    return specimen;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    generate();
  });
  panel.addEventListener('keydown', event => event.stopPropagation());
  panel.addEventListener('keyup', event => event.stopPropagation());
  field('species').addEventListener('change', () => {
    const [height, radius] = field('species').selectedOptions[0].dataset.size.split(' ');
    field('height').value = height;
    field('radius').value = radius;
    generate();
  });
  lod.forEach(button => button.addEventListener('click', () => {
    const level = Number(button.dataset.level);
    setLevel(level);
    if (!specimen) {
      generate();
      return;
    }
    const result = run('game forests lod ' + level);
    status.value = result.startsWith('ок:') ? 'LOD ' + level : result;
  }));
  form.querySelector('[data-seed]').addEventListener('click', () => {
    field('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    generate();
  });
  form.querySelector('[data-save]').addEventListener('click', () => {
    if (!form.reportValidity()) return;
    const preset = values();
    const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'd37-tree-' + preset.species + '-' + preset.seed + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const load = field('preset');
  load.addEventListener('change', async () => {
    try {
      const file = load.files[0];
      if (!file || file.size > 4096) throw new Error();
      const preset = JSON.parse(await file.text());
      if (!Array.from(field('species').options).some(option => option.value === preset.species)
          || ![preset.seed, preset.height, preset.radius, preset.crown].every(Number.isFinite)
          || ![0, 1, 2].includes(preset.lod)) throw new Error();
      for (const name of ['species', 'seed', 'height', 'radius', 'crown']) field(name).value = preset[name];
      setLevel(preset.lod);
      generate();
    } catch {
      status.value = 'Этот файл не похож на пресет дерева D37';
    } finally {
      load.value = '';
    }
  });
  panel.hidden = false;
  run('person first');
  generate();
}
