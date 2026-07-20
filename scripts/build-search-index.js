const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = [
  'index.html',
  'about.html',
  'experience.html',
  'cad.html',
  'manufacturing-systems.html',
  'robotics-automation.html',
  'dissertation.html'
];

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','have','he','in','is','it',
  'its','of','on','or','she','that','the','this','to','was','were','will','with','you',
  'your','we','our','i','my','me','but','not','can','all','any','if','so','do','does',
  'did','been','being','had','here','there','which','who','what','when','where','how','than',
  'then','them','they','their','also','more','most','some','such','into','over','under','out','up','down'
]);

function stem(word) {
  let w = word.toLowerCase();
  if (w.length < 4) return w;
  if (w.endsWith('ingly')) return w.slice(0, -5);
  if (w.endsWith('edly')) return w.slice(0, -4);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

function tokenise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

function stripHtml(html) {
  let s = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (m) return m[1].replace(/\s*\|.*$/, '').trim();
  const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h ? stripHtml(h[1]).slice(0, 120) : '';
}

function extractDescription(html) {
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : '';
}

const docs = [];
const df = new Map();

for (const file of PAGES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.warn('Skipping missing file:', file);
    continue;
  }
  const html = fs.readFileSync(full, 'utf8');
  const title = extractTitle(html);
  const description = extractDescription(html);
  const bodyText = stripHtml(html);
  const tokens = tokenise(title + ' ' + description + ' ' + bodyText);
  const tf = {};
  for (const tok of tokens) tf[tok] = (tf[tok] || 0) + 1;
  for (const tok of Object.keys(tf)) df.set(tok, (df.get(tok) || 0) + 1);
  docs.push({
    url: file,
    title,
    description,
    excerpt: bodyText.slice(0, 300),
    length: tokens.length,
    tf
  });
  console.log(`Indexed ${file}: ${tokens.length} tokens`);
}

const avgdl = docs.reduce((s, d) => s + d.length, 0) / docs.length;

const index = {
  built: new Date().toISOString(),
  avgdl,
  docCount: docs.length,
  df: Object.fromEntries(df),
  docs: docs.map(d => ({
    url: d.url,
    title: d.title,
    description: d.description,
    excerpt: d.excerpt,
    length: d.length,
    tf: d.tf
  }))
};

const outPath = path.join(ROOT, 'search-index.json');
fs.writeFileSync(outPath, JSON.stringify(index));
console.log(`\nWrote ${outPath}`);
console.log(`Docs: ${docs.length}, avg length: ${avgdl.toFixed(1)}, unique terms: ${df.size}`);