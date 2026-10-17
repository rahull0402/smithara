// Switch the site's canonical domain (canonical links, Open Graph URLs, JSON-LD, sitemap, robots.txt).
// Usage: node scripts/set-domain.mjs https://www.example.com
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(next)) {
  console.error('Usage: node scripts/set-domain.mjs https://www.example.com');
  process.exit(1);
}

const current = readFileSync(join(root, 'index.html'), 'utf8').match(/<link rel="canonical" href="(https:\/\/[^/"]+)\/">/)?.[1];
if (!current) throw new Error('Could not find the current canonical domain in index.html');
if (current === next) { console.log('Domain already set to ' + next); process.exit(0); }

const files = readdirSync(root).filter((f) => /\.(html|xml|txt)$/.test(f));
for (const f of files) {
  const path = join(root, f);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(current)) continue;
  writeFileSync(path, text.split(current).join(next));
  console.log('updated ' + f);
}
console.log(`Domain changed: ${current} -> ${next}`);
