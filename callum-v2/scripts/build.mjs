import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const manifest = JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8'));
const destination = join(root, 'dist');
await mkdir(destination, { recursive: true });
await cp(join(root, 'apps/web'), join(destination, 'web'), { recursive: true, force: true });
await cp(join(root, 'extension'), join(destination, 'extension'), { recursive: true, force: true });
await writeFile(join(destination, 'extension', 'build-info.js'),
  `globalThis.CALLUM_V2_BUILD = Object.freeze({ sha: '${sha}', protocol: 1, adapter: 4, environment: 'canary' });\n`);
const files = (await readdir(join(destination, 'extension'))).filter(name => name.endsWith('.js')).map(name => join(destination, 'extension', name));
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (/COCKROACH_DATABASE_URL|V2_ADMIN_TOKEN|BEGIN PRIVATE KEY|new Function\s*\(|\beval\s*\(/.test(source)) throw new Error(`Unsafe extension bundle: ${file}`);
}
console.log(JSON.stringify({ web: join(destination,'web'), extension: join(destination,'extension'), buildSha: sha, version: manifest.version }));
