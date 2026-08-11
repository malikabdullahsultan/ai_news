import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const REPORTS = path.join(ROOT, 'reports');
const DEMO_REPORT = path.join(ROOT, 'data', 'demo', 'sample-report.md');
const SITE_CONFIG = JSON.parse(await fs.readFile(path.join(ROOT, 'config', 'site.json'), 'utf8'));
const BASE_PATH = normalizeBase(process.env.PUBLIC_BASE_PATH || SITE_CONFIG.basePath || '/');
const TIMEZONE = SITE_CONFIG.timezone || 'Asia/Hong_Kong';

function normalizeBase(value) {
  let base = String(value || '/').trim();
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base += '/';
  return base;
}

function urlFor(value = '') {
  const clean = String(value).replace(/^\/+/, '');
  return `${BASE_PATH}${clean}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value = '') {
  const candidate = String(value).trim();
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith('/')) return candidate;
  return '#';
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
}

function parseScalar(value = '') {
  const text = value.trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replaceAll('\\"', '"');
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

function parseMarkdownFile(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const frontmatter = {};
  let body = raw;
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      frontmatter[key] = parseScalar(line.slice(separator + 1));
    }
    body = raw.slice(match[0].length);
  }
  return { frontmatter, body };
}

function inlineMarkdown(value = '') {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = safeUrl(href);
    const external = /^https?:\/\//i.test(safe) ? ' target="_blank" rel="noreferrer noopener"' : '';
    return `<a href="${escapeHtml(safe)}"${external}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
  return text;
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html = [];
  const headings = [];
  let paragraph = [];
  let listType = null;
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];
  let inQuote = false;
  let quoteLines = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushQuote = () => {
    if (quoteLines.length) {
      flushParagraph();
      html.push(`<blockquote>${quoteLines.map(line => `<p>${inlineMarkdown(line)}</p>`).join('')}</blockquote>`);
      quoteLines = [];
      inQuote = false;
    }
  };
  const flushTable = (start) => {
    const rows = [];
    let cursor = start;
    while (cursor < lines.length && /^\s*\|.*\|\s*$/.test(lines[cursor])) {
      const cells = lines[cursor].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      rows.push(cells);
      cursor += 1;
    }
    if (rows.length >= 2 && rows[1].every(cell => /^:?-{3,}:?$/.test(cell))) {
      flushParagraph();
      closeList();
      const header = rows.shift();
      rows.shift();
      html.push(`<div class="table-wrap"><table><thead><tr>${header.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, i) => `<td>${inlineMarkdown(row[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      return cursor;
    }
    return null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inCode) {
      if (/^\s*```/.test(line)) {
        html.push(`<pre><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLanguage = '';
      } else {
        codeLines.push(line);
      }
      continue;
    }
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      flushParagraph();
      closeList();
      flushQuote();
      inCode = true;
      codeLanguage = fence[1].trim() || 'text';
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableEnd = flushTable(index);
      if (tableEnd !== null) {
        index = tableEnd - 1;
        continue;
      }
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(line) || /^\s*\*\s*\*\s*\*\s*$/.test(line)) {
      flushParagraph();
      closeList();
      flushQuote();
      html.push('<hr>');
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      inQuote = true;
      quoteLines.push(quote[1]);
      continue;
    }
    if (inQuote && !/^\s*$/.test(line)) flushQuote();
    if (/^\s*$/.test(line)) {
      flushParagraph();
      closeList();
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextType = ordered ? 'ol' : 'ul';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        html.push(`<${listType}>`);
      }
      html.push(`<li>${inlineMarkdown((ordered || unordered)[1])}</li>`);
      continue;
    }
    if (listType) closeList();
    paragraph.push(line.trim());
  }
  if (inCode) html.push(`<pre><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph();
  closeList();
  flushQuote();
  return { html: html.join('\n'), headings };
}

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function filesUnder(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await filesUnder(full));
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function loadReports() {
  const files = await filesUnder(REPORTS);
  const reports = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = parseMarkdownFile(raw);
    const date = String(parsed.frontmatter.date || path.basename(file, '.md'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rendered = renderMarkdown(parsed.body);
    reports.push({
      date,
      title: String(parsed.frontmatter.title || 'The Daily AI Intelligence Report'),
      subtitle: String(parsed.frontmatter.subtitle || 'What actually mattered in AI today.'),
      generatedAt: String(parsed.frontmatter.generated_at || ''),
      timezone: String(parsed.frontmatter.timezone || TIMEZONE),
      model: String(parsed.frontmatter.model || ''),
      body: parsed.body,
      html: rendered.html,
      headings: rendered.headings,
      excerpt: plainText(parsed.body).slice(0, 260),
      words: plainText(parsed.body).split(/\s+/).filter(Boolean).length,
      url: urlFor(`reports/${date}/`),
      sourceFile: path.relative(ROOT, file)
    });
  }
  reports.sort((a, b) => b.date.localeCompare(a.date));
  return reports;
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, ...options }).format(new Date(`${date}T12:00:00Z`));
}

function readingTime(words) {
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function siteShell({ title, description, body, active = '', canonical = '', demo = false }) {
  const fullTitle = title === SITE_CONFIG.siteName ? title : `${title} — ${SITE_CONFIG.siteName}`;
  const navLink = (href, label, key) => `<a class="nav-link ${active === key ? 'is-active' : ''}" href="${urlFor(href)}">${label}</a>`;
  return `<!doctype html>
<html lang="en" data-theme="system">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="#17122d">
    <link rel="icon" href="${urlFor('favicon.svg')}" type="image/svg+xml">
    ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
    <title>${escapeHtml(fullTitle)}</title>
    <link rel="stylesheet" href="${urlFor('assets/site.css')}">
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="nav-wrap">
        <a class="brand" href="${urlFor('')}"><span class="brand-mark">DI</span><span><strong>Daily AI</strong><small>Intelligence</small></span></a>
        <nav class="main-nav" aria-label="Main navigation">
          ${navLink('latest/', 'Latest', 'latest')}
          ${navLink('archive/', 'Archive', 'archive')}
          ${navLink('search/', 'Search', 'search')}
        </nav>
        <div class="nav-actions"><button class="icon-button" type="button" data-theme-toggle aria-label="Change color theme" title="Change color theme">◐</button><a class="github-link" href="https://github.com/malikabdullahsultan/ai_news" target="_blank" rel="noreferrer noopener" aria-label="Open project on GitHub">GitHub ↗</a></div>
      </div>
    </header>
    ${demo ? '<div class="demo-banner"><span>DEMO MODE</span> The production archive is empty, so you are viewing a local sample report.</div>' : ''}
    <main id="main">${body}</main>
    <footer class="site-footer"><div><span class="brand-mark small">DI</span> <strong>Daily AI Intelligence</strong></div><span>Evidence first. Hype second.</span><span>Built for curious minds.</span></footer>
    <script>window.DAILY_AI_BASE=${JSON.stringify(BASE_PATH)};</script>
    <script src="${urlFor('assets/client.js')}" defer></script>
  </body>
</html>`;
}

function heroBlock() {
  return `<section class="hero page-container"><div class="hero-copy"><div class="eyebrow"><span class="pulse-dot"></span> Daily signal · ${escapeHtml(TIMEZONE.replace('_', ' '))}</div><h1>Your daily map of what actually matters in <span class="gradient-text">artificial intelligence.</span></h1><p class="hero-lede">A personal Bloomberg terminal for AI — understandable, skeptical, and built for people who want to know what changed and why it matters.</p><div class="hero-actions"><a class="button button-primary" href="${urlFor('latest/')}">Read the latest report <span>→</span></a><a class="text-link" href="${urlFor('archive/')}">Browse the archive <span>↗</span></a></div></div><div class="hero-orbit" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit-core"><span>AI</span><small>signal</small></div><div class="orbit-items"><div class="orbit-item orbit-item-one"><span>MODELS</span></div><div class="orbit-item orbit-item-two"><span>AGENTS</span></div><div class="orbit-item orbit-item-three"><span>EVIDENCE</span></div><div class="orbit-item orbit-item-four"><span>ROBOTS</span></div></div></div></section>`;
}

function latestCard(report, demo = false) {
  return `<section class="latest-card page-container"><div class="section-kicker"><span>LATEST REPORT</span><span class="section-line"></span><span>${report ? escapeHtml(formatDate(report.date, { month: 'short', day: 'numeric', year: 'numeric' })) : 'Awaiting first report'}</span></div><div class="latest-grid"><div><h2>${escapeHtml(report?.subtitle || 'Your first signal is almost here.')}</h2><p>${escapeHtml(report?.excerpt || 'Run the daily workflow to turn fresh research into a readable, source-linked report.')}</p><div class="card-meta">${report ? `<span>${readingTime(report.words)}</span><span>·</span><span>${demo ? 'Sample content' : 'Verified research pipeline'}</span>` : '<span>GitHub Actions ready</span>'}</div></div><div class="latest-cta"><a class="button button-light" href="${urlFor(demo ? 'demo/' : 'latest/')}">${demo ? 'Open demo report' : 'Read today\'s report'} <span>→</span></a><div class="latest-date">${report ? escapeHtml(report.date.replaceAll('-', '.')) : '03:30 HKT'}<small>${report ? 'Hong Kong date' : 'daily schedule'}</small></div></div></div></section>`;
}

function statsBlock(reports) {
  const years = new Set(reports.map(report => report.date.slice(0, 4))).size;
  return `<section class="stats page-container"><div class="stat"><strong>${reports.length || '—'}</strong><span>reports in archive</span></div><div class="stat"><strong>${years || '—'}</strong><span>${years === 1 ? 'year' : 'years'} of signal</span></div><div class="stat"><strong>0<span class="stat-unit">$</span></strong><span>AI API cost by default</span></div><div class="stat"><strong>24<span class="stat-unit">/7</span></strong><span>static site availability</span></div></section>`;
}

function archiveCards(reports) {
  if (!reports.length) return `<div class="empty-state"><span class="empty-icon">✦</span><h3>The archive is waiting for its first signal.</h3><p>The scheduled workflow will research, write, validate, and publish the first report without a server or paid API key.</p><a class="text-link" href="https://github.com/malikabdullahsultan/ai_news/blob/main/SETUP.md" target="_blank" rel="noreferrer noopener">See setup notes <span>→</span></a></div>`;
  return `<div class="archive-grid">${reports.slice(0, 9).map((report, index) => `<a class="archive-card ${index === 0 ? 'is-newest' : ''}" href="${report.url}"><div class="archive-card-top"><span>${escapeHtml(formatDate(report.date, { month: 'short' }).toUpperCase())}</span><span>${escapeHtml(report.date.slice(0, 4))}</span></div><div class="archive-day">${escapeHtml(report.date.slice(-2))}</div><div class="archive-card-bottom"><span>${escapeHtml(report.subtitle)}</span><span class="arrow">↗</span></div></a>`).join('')}</div>`;
}

function homeBody(reports, latest, demo) {
  return `${heroBlock()}${latestCard(latest, demo)}${statsBlock(reports)}<section class="archive-section page-container"><div class="section-heading"><div><div class="eyebrow">THE ARCHIVE</div><h2>Every day, one clearer signal.</h2></div><a class="text-link" href="${urlFor('archive/')}">View all reports <span>→</span></a></div>${archiveCards(reports)}</section><section class="principles page-container"><div class="principle-intro"><div class="eyebrow">HOW IT WORKS</div><h2>Curiosity, with a fact-checker attached.</h2><p>Fresh sources are collected, clustered, and passed through a zero-cost-first workflow. The writing stays energetic; the evidence stays visible.</p></div><div class="principle-grid"><article><span class="principle-number">01</span><h3>Research first</h3><p>Official announcements, papers, repositories, and model cards lead the queue.</p></article><article><span class="principle-number">02</span><h3>Hype detector on</h3><p>Claims are labeled, benchmarks are compared, and demos meet healthy skepticism.</p></article><article><span class="principle-number">03</span><h3>Free by default</h3><p>SambaNova's Free Tier powers the normal loop. Quota exhaustion fails safely.</p></article></div></section>`;
}

function reportBody(report, demo = false) {
  const sourceNote = report.model ? `<span>Generated with ${escapeHtml(report.model)}</span>` : '';
  return `<section class="report-hero page-container"><div class="breadcrumb"><a href="${urlFor('')}">Home</a><span>/</span><a href="${urlFor('archive/')}">Archive</a><span>/</span><span>${escapeHtml(report.date)}</span></div><div class="eyebrow"><span class="pulse-dot"></span> Daily AI Intelligence · ${escapeHtml(report.date)}</div><h1>${escapeHtml(report.title)}</h1><p class="report-subtitle">${escapeHtml(report.subtitle)}</p><div class="report-meta"><span>${escapeHtml(formatDate(report.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</span><span>·</span><span>${readingTime(report.words)}</span>${sourceNote ? `<span>·</span>${sourceNote}` : ''}</div></section><div class="report-layout page-container"><a class="back-link" href="${urlFor('archive/')}">← Back to archive</a><article class="report-content">${report.html}</article></div>`;
}

function archiveBody(reports) {
  const years = {};
  for (const report of reports) (years[report.date.slice(0, 4)] ||= []).push(report);
  const groups = Object.entries(years).map(([year, items]) => `<section class="year-group"><div class="year-label">${escapeHtml(year)} <span>${items.length} ${items.length === 1 ? 'report' : 'reports'}</span></div><div class="archive-list">${items.map(report => `<a href="${report.url}" class="archive-row"><span class="archive-row-date"><strong>${escapeHtml(report.date.slice(-2))}</strong><small>${escapeHtml(formatDate(report.date, { month: 'short' }).toUpperCase())}</small></span><span class="archive-row-title"><strong>${escapeHtml(report.subtitle)}</strong><small>${escapeHtml(report.excerpt)}</small></span><span class="archive-row-arrow">↗</span></a>`).join('')}</div></section>`).join('');
  const activeDates = JSON.stringify(reports.map(report => report.date));
  return `<section class="page-container archive-header"><div class="eyebrow">REPORT ARCHIVE</div><h1>A running record of the AI race.</h1><p>Newest first. One report per Hong Kong calendar day. Use the date picker to jump straight to a report.</p><div class="archive-tools"><label for="report-date">Jump to date</label><input id="report-date" type="date" data-report-date min="2020-01-01"><button class="button button-dark" type="button" data-date-go>Open report →</button><span class="date-feedback" data-date-feedback></span></div></section><section class="page-container archive-content" data-report-dates='${escapeHtml(activeDates)}'>${groups || '<div class="empty-state"><span class="empty-icon">✦</span><h3>No production reports yet.</h3><p>Run the workflow once, then this page will become your daily archive.</p></div>'}</section>`;
}

function searchBody() {
  return `<section class="page-container search-header"><div class="eyebrow">SEARCH THE SIGNAL</div><h1>Find the thread.</h1><p>Search every report title, source mention, concept, and company in the static archive.</p><div class="search-large"><span>⌕</span><input data-search-input type="search" placeholder="Try “agents”, “Qwen”, or “NVIDIA”" autofocus></div><div class="search-status" data-search-status>Loading the archive index…</div></section><section class="page-container search-results" data-search-results></section>`;
}

async function writeFile(relative, contents) {
  const target = path.join(DIST, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, 'utf8');
}

const reports = await loadReports();
let demo = false;
let latest = reports[0];
if (!latest) {
  const raw = await fs.readFile(DEMO_REPORT, 'utf8');
  const parsed = parseMarkdownFile(raw);
  const rendered = renderMarkdown(parsed.body);
  latest = {
    date: String(parsed.frontmatter.date),
    title: String(parsed.frontmatter.title),
    subtitle: String(parsed.frontmatter.subtitle),
    generatedAt: '',
    timezone: TIMEZONE,
    model: 'demo fixture',
    body: parsed.body,
    html: rendered.html,
    headings: rendered.headings,
    excerpt: plainText(parsed.body).slice(0, 260),
    words: plainText(parsed.body).split(/\s+/).filter(Boolean).length,
    url: urlFor('demo/')
  };
  demo = true;
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });
await writeFile('assets/site.css', await fs.readFile(path.join(ROOT, 'src', 'styles', 'site.css'), 'utf8'));
await writeFile('assets/client.js', await fs.readFile(path.join(ROOT, 'src', 'client.js'), 'utf8'));
await writeFile('favicon.svg', await fs.readFile(path.join(ROOT, 'public', 'favicon.svg'), 'utf8'));
await writeFile('CNAME', await fs.readFile(path.join(ROOT, 'CNAME'), 'utf8'));
await writeFile('index.json', JSON.stringify(reports.map(report => ({ date: report.date, title: report.title, subtitle: report.subtitle, url: report.url, excerpt: report.excerpt, words: report.words })), null, 2));

await writeFile('index.html', siteShell({ title: SITE_CONFIG.siteName, description: SITE_CONFIG.tagline, body: homeBody(reports, latest, demo), active: 'home', demo }));
await writeFile('latest/index.html', siteShell({ title: latest.title, description: latest.subtitle, body: reportBody(latest, demo), active: 'latest', demo }));
await writeFile('archive/index.html', siteShell({ title: 'Report Archive', description: 'Browse every Daily AI Intelligence report.', body: archiveBody(reports), active: 'archive' }));
await writeFile('search/index.html', siteShell({ title: 'Search', description: 'Search the Daily AI Intelligence archive.', body: searchBody(), active: 'search' }));
if (demo) await writeFile('demo/index.html', siteShell({ title: latest.title, description: latest.subtitle, body: reportBody(latest, true), active: 'latest', demo: true }));
for (const report of reports) await writeFile(`reports/${report.date}/index.html`, siteShell({ title: report.title, description: report.subtitle, body: reportBody(report), active: 'archive' }));
await writeFile('404.html', siteShell({ title: 'Signal not found', description: 'That Daily AI Intelligence page does not exist.', body: `<section class="page-container not-found"><div class="eyebrow">404 · LOST SIGNAL</div><h1>That page wandered off into the latent space.</h1><p>Try the latest report or return to the archive.</p><a class="button button-primary" href="${urlFor('')}">Back home →</a></section>` }));
console.log(`Built ${reports.length} production report(s)${demo ? ' with demo fallback' : ''} into ${path.relative(ROOT, DIST)}/ using base path ${BASE_PATH}`);
