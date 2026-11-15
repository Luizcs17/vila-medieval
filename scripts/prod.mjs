// Stable "prod" copy of the game, separate from development.
//
//   node scripts/prod.mjs update   → (create and) move the prod copy to the latest `main`, install, build
//   node scripts/prod.mjs serve    → serve the prod build on http://localhost:4173
//
// The prod copy is a git worktree next to this folder ("<folder>-prod"), detached at `main`, so
// edits here never touch it until you update it. Its save game is separate from dev's because
// the browser keeps storage per origin (port 4173 vs 5173).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prod = join(dirname(root), `${basename(root)}-prod`);
const PORT = 4173;

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

function update() {
  if (!existsSync(prod)) run(`git worktree add --detach "${prod}" main`, root);
  else run('git checkout --detach main', prod);
  run('npm ci', prod);
  run('npm run build', prod);
  const rev = execSync('git log -1 --format="%h %s"', { cwd: prod }).toString().trim();
  console.log(`\nProd atualizado para: ${rev}`);
  console.log(`Sirva com: npm run prod  →  http://localhost:${PORT}`);
}

function serve() {
  if (!existsSync(join(prod, 'dist', 'index.html'))) {
    console.error('Ainda não há build de prod. Rode primeiro: npm run prod:update');
    process.exit(1);
  }
  run(`npx vite preview --port ${PORT} --strictPort`, prod);
}

const cmd = process.argv[2];
if (cmd === 'update') update();
else if (cmd === 'serve') serve();
else {
  console.error('Uso: node scripts/prod.mjs <update|serve>');
  process.exit(1);
}
