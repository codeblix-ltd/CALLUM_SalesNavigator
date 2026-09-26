import { execFileSync } from 'node:child_process';
const base = '68f5971a5e4b91d0814cd0f2b32dd18dbd64237b';
const protectedPaths = [
  'internal-vite-react-lead-operations/chrome-extension',
  'internal-vite-react-lead-operations/convex',
  'internal-vite-react-lead-operations/database',
  '.github/workflows/deploy-lead-app.yml'
];
const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', ...protectedPaths], { encoding: 'utf8' }).trim();
const unstaged = execFileSync('git', ['status', '--porcelain=v1', '--', ...protectedPaths], { encoding: 'utf8' }).trim();
if (changed || unstaged) { console.error('Protected V1 paths changed', changed, unstaged); process.exitCode = 1; }
else console.log(`Protected V1 paths unchanged relative to ${base}`);
