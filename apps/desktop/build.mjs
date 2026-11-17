// Empaqueta main y preload con esbuild (incluye @pos/hardware y @pos/shared).
// serialport (nativo), iconv-lite y electron-updater quedan como dependencias externas.
import { build } from 'esbuild';

const comun = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'serialport', 'iconv-lite', 'electron-updater'],
};

await build({ ...comun, entryPoints: ['src/main.ts'], outfile: 'dist/main.js' });
await build({ ...comun, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' });
await build({ ...comun, entryPoints: ['src/preload-visor.ts'], outfile: 'dist/preload-visor.js' });
console.log('desktop: compilado');
