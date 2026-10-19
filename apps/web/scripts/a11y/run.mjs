// Full a11y pipeline driver: temp API + next start + mirror + axe per page.
// Usage: node run.mjs --repo <repoRoot> --out <outDir> [--pages home,fatwa,donate,login,library]
// Exit 0: no Critical violations. Exit 2: Critical violations found. Exit 3: infra failure.
import { spawn, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]] = process.argv[i + 1];
const REPO = path.resolve(args['--repo'] || '');
const OUT = path.resolve(args['--out'] || '');
const PAGES = (args['--pages'] || 'home,fatwa,donate,login,library').split(',');
const API_PORT = Number(process.env.P17_A11Y_API_PORT || 18081);
const WEB_PORT = Number(process.env.P17_A11Y_WEB_PORT || 13101);
const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
if (!REPO || !OUT) { console.error('usage: run.mjs --repo <repoRoot> --out <outDir>'); process.exit(3); }

const API_DIR = path.join(REPO, 'apps/api');
const WEB_DIR = path.join(REPO, 'apps/web');
const VENV_PY = path.join(API_DIR, '.venv/bin/python');
const DB = path.join(OUT, 'a11y-api.db');
const PAGE_PATHS = { home: '/fa', fatwa: '/fa/fatwa', donate: '/fa/donate', login: '/fa/login', library: '/fa/library' };

fs.mkdirSync(OUT, { recursive: true });
const children = [];
const killAll = () => { for (const c of children) { try { c.kill('SIGKILL'); } catch {} } };
process.on('exit', killAll);

function waitPort(port, tries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => { s.destroy(); if (++n > tries) reject(new Error(`port ${port} not ready`)); else setTimeout(tick, 1000); });
    };
    tick();
  });
}
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const code = execSync(`curl -s -m 5 -o /dev/null -w "%{http_code}" "${url}"`).toString().trim();
      if (code === '200') return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`GET ${url} never 200`);
}

try {
  // 1) temp DB + schema + seed (home sections so the hero/h1 renders)
  if (fs.existsSync(DB)) fs.rmSync(DB);
  execFileSync(VENV_PY, ['-c', `
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.database import Base
import app.models
from app.seed import seed_home_sections, seed_platform_settings_defaults
async def main():
    eng = create_async_engine("sqlite+aiosqlite:///${DB}")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        await seed_home_sections(db)
        await seed_platform_settings_defaults(db)
        await db.commit()
    await eng.dispose()
asyncio.run(main())
`], { cwd: API_DIR, stdio: 'inherit' });

  // 2) API
  const api = spawn(VENV_PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(API_PORT), '--log-level', 'warning'], {
    cwd: API_DIR, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: `sqlite+aiosqlite:///${DB}`, APP_ENV: 'dev' },
  });
  children.push(api);
  await waitHttp(`http://127.0.0.1:${API_PORT}/api/v1/home/sections`);

  // 3) next start
  const web = spawn(path.join(WEB_DIR, 'node_modules/.bin/next'), ['start', '-p', String(WEB_PORT)], {
    cwd: WEB_DIR, stdio: 'ignore',
    env: { ...process.env, API_URL: `http://127.0.0.1:${API_PORT}`, NODE_OPTIONS: '--max-old-space-size=2048' },
  });
  children.push(web);
  await waitPort(WEB_PORT);
  await waitHttp(`http://127.0.0.1:${WEB_PORT}/fa`);

  // 4) mirror + axe per page
  const pagesDir = path.join(OUT, 'pages');
  const results = [];
  for (const slug of PAGES) {
    const pagePath = PAGE_PATHS[slug];
    if (!pagePath) throw new Error(`unknown page ${slug}`);
    execFileSync('node', [path.join(HERE, 'mirror-page.mjs'), String(WEB_PORT), pagePath, slug, pagesDir], { stdio: 'inherit' });
    const json = path.join(OUT, `${slug}-axe.json`);
    const png = path.join(OUT, `${slug}-shot.png`);
    execFileSync('node', [path.join(HERE, 'axe-run.mjs'), path.join(pagesDir, slug), json, png, '--wait', '5000'], { stdio: 'inherit' });
    results.push({ slug, file: json });
  }

  // 5) summary
  const summary = { pages: {}, totals: { critical: 0, serious: 0, moderate: 0, minor: 0 } };
  for (const { slug, file } of results) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of d.violations) {
      if (byImpact[v.impact] !== undefined) { byImpact[v.impact]++; summary.totals[v.impact]++; }
    }
    summary.pages[slug] = { violations: d.violations.length, passes: d.passes, byImpact,
      rules: d.violations.map((v) => `${v.impact}:${v.id}`) };
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  killAll();
  if (summary.totals.critical > 0) { console.error(`A11Y FAIL: ${summary.totals.critical} critical violations`); process.exit(2); }
  console.log('A11Y OK: no critical violations');
} catch (e) {
  console.error('A11Y INFRA FAILURE:', e.message);
  killAll();
  process.exit(3);
}
