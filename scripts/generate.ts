// Usage: npm run generate -- examples/vortex.json [outDir] [--pack=3mf|stl] [--openscad]
// Writes artboard.scad + summary.json. --pack writes the same print pack zip the app makes;
// --openscad renders every part through the OpenSCAD CLI instead (slow, but a good cross-check).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { generateDesign, toScad, buildPrintPack, MeshFormat } from '../src/core/index';

const args = process.argv.slice(2);
const stl = args.includes('--openscad');
const packArg = args.find((a) => a.startsWith('--pack'));
const packFormat = (packArg?.split('=')[1] ?? '3mf') as MeshFormat;
const [input, outArg] = args.filter((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: npm run generate -- <params.json> [outDir] [--pack=3mf|stl] [--openscad]');
  process.exit(1);
}
const params = JSON.parse(readFileSync(input, 'utf8'));
const design = generateDesign(params);
if (design.errors.length) {
  console.error('Design has errors:\n- ' + design.errors.join('\n- '));
  process.exit(2);
}
const out = outArg ?? join('out', basename(input, '.json'));
mkdirSync(out, { recursive: true });
const scadPath = join(out, 'artboard.scad');
writeFileSync(scadPath, toScad(design));
writeFileSync(join(out, 'summary.json'), JSON.stringify({ stats: design.stats, warnings: design.warnings, palette: design.palette }, null, 2));
console.log(`Wrote ${scadPath}`);
console.log(design.stats);
for (const w of design.warnings) console.log('warning:', w);

if (packArg) {
  const zip = await buildPrintPack(design, { format: packFormat });
  const file = join(out, 'print-pack.zip');
  writeFileSync(file, zip);
  console.log(`Wrote ${file} (${(zip.length / 1e6).toFixed(1)} MB)`);
}

if (stl) {
  const render = (name: string, part: string, index = 0) => {
    const file = join(out, `${name}.stl`);
    execFileSync('openscad', ['-q', '-D', `part="${part}"`, '-D', `index=${index}`, '-o', file, scadPath], { stdio: 'inherit' });
    console.log('rendered', file);
  };
  design.sections.forEach((s) => render(`backplate_${String(s.id + 1).padStart(2, '0')}`, 'section', s.id));
  design.plates.forEach((pl) =>
    render(pl.kind === 'keys' ? `keys_plate_${pl.id + 1}` : `color${pl.color + 1}_plate_${String(pl.id + 1).padStart(3, '0')}`, 'plate', pl.id),
  );
  render('fit_test', 'fit_test');
}
