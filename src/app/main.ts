import './style.css';
import { DesignParams, PartialParams, defaultParams, generateDesign, toScad, withDefaults, Design, buildPrintPack, assemblyMapSVG, MeshFormat } from '../core/index';
import { GROUPS, Control, getPath, setPath } from './controls';
import { Preview, View } from './preview';
import { PRESETS } from './presets';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) (e as any)[k] = v;
    else if (v !== undefined && v !== false) e.setAttribute(k, String(v));
  }
  e.append(...kids);
  return e;
};

let params: DesignParams = loadFromHash() ?? withDefaults(PRESETS[0].params);
let design: Design;
const open = new Set<string>(['size', 'pattern']);

const preview = new Preview($('#viewport'));

function loadFromHash(): DesignParams | null {
  try {
    const h = location.hash.slice(1);
    if (!h.startsWith('d=')) return null;
    const json = decodeURIComponent(escape(atob(h.slice(2).replace(/-/g, '+').replace(/_/g, '/'))));
    return withDefaults(JSON.parse(json) as PartialParams);
  } catch {
    return null;
  }
}

function shareLink(): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(params)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#d=${b64}`;
}

// ---------- panel ----------

function renderPanel() {
  const panel = $('#groups');
  panel.replaceChildren();
  GROUPS.forEach((g, gi) => {
    const isOpen = open.has(g.id);
    const head = el(
      'button',
      {
        class: 'group-head' + (isOpen ? ' open' : ''),
        'aria-expanded': isOpen,
        onclick: () => {
          if (open.has(g.id)) open.delete(g.id);
          else open.add(g.id);
          renderPanel();
        },
      },
      el('span', { class: 'badge' }, String(gi + 1)),
      el('span', { class: 'titles' }, el('span', { class: 'title' }, g.title), el('span', { class: 'summary' }, g.summary(params))),
      el('span', { class: 'chev' }, '⌄'),
    );
    const body = el('div', { class: 'group-body' });
    if (isOpen) for (const c of g.controls) {
      if ('showIf' in c && c.showIf && !c.showIf(params)) continue;
      body.append(renderControl(c));
    }
    panel.append(el('section', { class: 'group' }, head, body));
  });
}

function change(path: string, value: any, rerenderPanel = false) {
  setPath(params, path, value);
  schedule();
  if (rerenderPanel) renderPanel();
  else updateSummaries();
}

function updateSummaries() {
  document.querySelectorAll('.group .summary').forEach((s, i) => (s.textContent = GROUPS[i].summary(params)));
}

function renderControl(c: Control): HTMLElement {
  const v = getPath(params, c.path);
  const label = el('div', { class: 'label' }, el('span', {}, c.label), 'hint' in c && c.hint ? el('span', { class: 'hint' }, c.hint) : '');
  switch (c.kind) {
    case 'range': {
      const num = el('input', { type: 'number', min: c.min, max: c.max, step: c.step, value: v }) as HTMLInputElement;
      const rng = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, value: v }) as HTMLInputElement;
      const set = (x: number) => {
        if (Number.isNaN(x)) return;
        num.value = String(x);
        rng.value = String(x);
        // Some ranges change which controls show; re-render only when needed.
        change(c.path, x, c.path === 'colors.count');
      };
      rng.oninput = () => set(parseFloat(rng.value));
      num.onchange = () => set(Math.max(c.min, Math.min(c.max, parseFloat(num.value))));
      return el('div', { class: 'ctl' }, label, el('div', { class: 'range-row' }, num, c.unit ? el('span', { class: 'unit' }, c.unit) : '', rng));
    }
    case 'select': {
      const s = el('select', { onchange: () => change(c.path, s.value, true) }) as HTMLSelectElement;
      for (const o of c.options) s.append(el('option', { value: o.value, selected: o.value === v }, o.label));
      return el('div', { class: 'ctl' }, label, s);
    }
    case 'segmented': {
      const row = el('div', { class: 'seg' });
      for (const o of c.options) {
        row.append(
          el('button', { class: o.value === v ? 'on' : '', onclick: () => change(c.path, o.value, true) },
            o.icon ? el('span', { class: 'icon' + (o.value === 'rounded' ? ' rounded' : '') }, o.icon) : '', o.label),
        );
      }
      return el('div', { class: 'ctl' }, label, row);
    }
    case 'toggle': {
      const cb = el('input', { type: 'checkbox', checked: !!v, onchange: () => change(c.path, cb.checked, true) }) as HTMLInputElement;
      return el('label', { class: 'ctl toggle' }, cb, el('span', {}, c.label, 'hint' in c && c.hint ? el('span', { class: 'hint' }, ` ${c.hint}`) : ''));
    }
    case 'palette': {
      const row = el('div', { class: 'palette' });
      const pal: string[] = v;
      for (let i = 0; i < params.colors.count; i++) {
        const inp = el('input', { type: 'color', value: pal[i] ?? '#cccccc', title: `Colour ${i + 1}` }) as HTMLInputElement;
        inp.oninput = () => {
          pal[i] = inp.value;
          change(c.path, [...pal]);
        };
        row.append(inp);
      }
      return el('div', { class: 'ctl' }, label, row);
    }
    case 'seed': {
      const num = el('input', { type: 'number', value: v, step: 1 }) as HTMLInputElement;
      num.onchange = () => change(c.path, parseInt(num.value) || 0);
      const dice = el('button', { class: 'ghost', onclick: () => { num.value = String(Math.floor(Math.random() * 99999)); change(c.path, parseInt(num.value)); } }, '🎲 Shuffle');
      return el('div', { class: 'ctl' }, label, el('div', { class: 'range-row' }, num, dice));
    }
  }
}

// ---------- generation ----------

let timer: number | undefined;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(regenerate, 120);
}

function regenerate() {
  const t0 = performance.now();
  design = generateDesign(structuredClone(params));
  const ms = performance.now() - t0;
  if (!design.errors.length) preview.update(design);
  renderStats(ms);
  history.replaceState(null, '', shareLink());
}

function renderStats(ms: number) {
  const s = design.stats;
  const box = $('#stats');
  box.replaceChildren();
  if (design.errors.length) {
    box.append(el('div', { class: 'errors' }, ...design.errors.map((e) => el('p', {}, '⚠ ', e))));
    return;
  }
  const kg = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${g} g`);
  const colorRows = design.palette.map((hex, i) =>
    el('button', {
      class: 'swatch-row',
      onmouseenter: () => preview.highlight(i),
      onmouseleave: () => preview.highlight(-1),
      title: 'Hover to highlight these tiles',
    },
      el('span', { class: 'swatch', style: `background:${hex}` }),
      el('span', {}, `${s.tilesPerColor[i]} tiles`),
      el('span', { class: 'muted' }, `≈ ${kg(s.gramsPerColor[i])}`),
    ),
  );
  box.append(
    el('div', { class: 'kpis' },
      kpi(String(s.tiles), 'tiles'),
      kpi(String(s.sections), 'backplate parts'),
      kpi(String(s.plates), 'print plates'),
      kpi(kg(s.gramsPerColor.reduce((a, b) => a + b, 0) + s.backplateGrams), 'filament (est.)'),
    ),
    el('div', { class: 'colors' }, ...colorRows,
      el('div', { class: 'swatch-row static' }, el('span', { class: 'swatch', style: 'background:#e4e0d8' }), el('span', {}, `Backplate, ${s.keys} keys`), el('span', { class: 'muted' }, `≈ ${kg(s.backplateGrams)}`)),
    ),
    ...design.warnings.map((w) => el('p', { class: 'warn' }, w)),
    el('p', { class: 'muted small' }, `Generated in ${Math.round(ms)} ms · tallest tile ${s.tallestTile.toFixed(1)} mm`),
  );
}

function kpi(v: string, l: string) {
  return el('div', { class: 'kpi' }, el('strong', {}, v), el('span', {}, l));
}

// ---------- toolbar ----------

function download(name: string, data: string | Blob, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function slug() {
  return `artboard-${params.pattern.type}-${params.width}x${params.height}`;
}

function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  (b.onclick = () => {
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    preview.setView(b.dataset.view as View);
  }),
);
($('#light') as HTMLInputElement).oninput = (e) => preview.setLightT(parseFloat((e.target as HTMLInputElement).value));
($('#seams') as HTMLInputElement).onchange = (e) => preview.setSeams((e.target as HTMLInputElement).checked);
$('#dl-scad').onclick = () => {
  if (design.errors.length) return toast('Fix the errors first');
  download(`${slug()}.scad`, toScad(design));
};
let busy = false;
$('#dl-pack').onclick = async () => {
  if (design.errors.length) return toast('Fix the errors first');
  if (busy) return;
  busy = true;
  const format = ($('#pack-format') as HTMLSelectElement).value as MeshFormat;
  const box = $('#progress');
  const bar = box.querySelector('i') as HTMLElement;
  const label = box.querySelector('span') as HTMLElement;
  box.hidden = false;
  try {
    const d = design;
    const zip = await buildPrintPack(d, {
      format,
      onProgress: (done, total, what) => {
        bar.style.width = `${(100 * done) / total}%`;
        label.textContent = `Building ${what} (${done} of ${total})`;
      },
    });
    download(`${slug()}-print-pack.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }));
    toast(`Print pack ready: ${d.stats.plates} plates, ${d.stats.sections} backplate parts`);
  } catch (e) {
    console.error(e);
    toast('Could not build the print pack');
  } finally {
    box.hidden = true;
    busy = false;
  }
};
$('#show-map').onclick = () => {
  if (design.errors.length) return toast('Fix the errors first');
  $('#map-body').innerHTML = assemblyMapSVG(design);
  $('#map-overlay').hidden = false;
};
$('#close-map').onclick = () => ($('#map-overlay').hidden = true);
$('#dl-map').onclick = () => download(`${slug()}-assembly-map.svg`, assemblyMapSVG(design), 'image/svg+xml');
$('#dl-json').onclick = () => download(`${slug()}.json`, JSON.stringify(params, null, 2), 'application/json');
$('#dl-png').onclick = async () => {
  const blob = await (await fetch(preview.snapshot())).blob();
  download(`${slug()}.png`, blob);
};
$('#share').onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareLink());
    toast('Link copied');
  } catch {
    prompt('Copy this link', shareLink());
  }
};
$('#load-json').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    params = withDefaults(JSON.parse(await f.text()));
    renderPanel();
    regenerate();
    toast('Design loaded');
  } catch {
    toast('That file is not a design');
  }
};
$('#reset').onclick = () => {
  params = defaultParams();
  renderPanel();
  regenerate();
};

const presetBox = $('#presets');
for (const pr of PRESETS) {
  presetBox.append(
    el('button', {
      class: 'preset',
      onclick: () => {
        params = withDefaults(structuredClone(pr.params));
        renderPanel();
        regenerate();
        preview.setView('iso');
      },
    }, el('span', { class: 'dots' }, ...(pr.params.colors?.palette ?? []).slice(0, pr.params.colors?.count ?? 3).map((c) => el('i', { style: `background:${c}` }))), pr.name),
  );
}

renderPanel();
regenerate();
preview.setView('iso');
