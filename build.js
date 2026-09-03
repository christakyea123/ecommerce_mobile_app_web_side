#!/usr/bin/env node
/**
 * ============================================================
 * GLOMEK STATIC BUILD
 * ============================================================
 * Produces `dist/` — the folder you deploy. File names and paths
 * are identical to the source tree, so index.html, sw.js and every
 * page reference keep working untouched; only the bytes get smaller.
 *
 *   npm run build
 *
 * Identifier mangling is deliberately OFF. These are classic
 * scripts sharing one global scope — app.js declares `state` and
 * mobile-app.js reads it — so renaming top-level symbols would
 * break the site. Whitespace and syntax minification are safe and
 * account for most of the saving anyway.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Copied verbatim.
const COPY = ['index.html', 'robots.txt', 'sitemap.xml', 'pages', 'assets'];

// Never shipped: dependencies, tests, tooling, VCS, editor config.
const NEVER_SHIP = new Set(['node_modules', 'tests', '.git', '.vscode', 'dist', 'build.js', 'stamp-assets.js', 'package.json', 'package-lock.json', '.gitignore', 'README.md']);

function rmrf(target) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyRecursive(from, to) {
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        for (const entry of fs.readdirSync(from)) {
            if (NEVER_SHIP.has(entry)) continue;
            copyRecursive(path.join(from, entry), path.join(to, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
    }
}

async function minifyDir(dirName, loader) {
    const srcDir = path.join(ROOT, dirName);
    const outDir = path.join(DIST, dirName);
    fs.mkdirSync(outDir, { recursive: true });

    let before = 0;
    let after = 0;

    for (const file of fs.readdirSync(srcDir)) {
        if (!file.endsWith('.' + loader)) continue;
        const src = fs.readFileSync(path.join(srcDir, file), 'utf8');

        const result = await esbuild.transform(src, {
            loader,
            minifyWhitespace: true,
            minifySyntax: true,
            minifyIdentifiers: false, // see header — globals are shared across files
            legalComments: 'none',
            // No down-levelling. Lowering syntax needs temporary identifiers,
            // which conflicts with minifyIdentifiers:false above — and the
            // source already targets browsers that support what it uses.
            target: 'esnext',
        });

        fs.writeFileSync(path.join(outDir, file), result.code);
        before += Buffer.byteLength(src);
        after += Buffer.byteLength(result.code);
    }

    return { before, after };
}

const kb = n => (n / 1024).toFixed(1) + ' KB';

/**
 * Collapses the many <link>/<script> tags in each page into one bundle each.
 *
 * The pages pull 11 stylesheets and 4 scripts individually. On a phone that is
 * 15 separate round trips before anything renders, and latency — not bytes —
 * is what makes it feel slow on mobile data.
 *
 * Concatenation order is taken from the page itself, so cascade order and the
 * shared global scope these classic scripts rely on are both preserved. The
 * individual files stay in dist/ as well, so nothing that references them
 * directly breaks.
 */
/**
 * The same eight-hex content stamp stamp-assets.js puts on the source pages.
 * The bundles need it too: their names come from what went into them, so two
 * different builds produce the same filename, and glomek.com serves CSS with
 * `cache-control: public, max-age=604800`.
 */
function stamp(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function bundlePage(htmlPath) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    const pageDir = path.dirname(htmlPath);

    // ?v=<hash> is a cache-busting stamp, not part of the path on disk.
    const bare = (href) => href.split('?')[0];
    const resolve = (href) => path.resolve(pageDir, bare(href));
    const isLocal = (href) => !/^https?:|^\/\//.test(href);

    // ── stylesheets ──────────────────────────────────────────────
    const cssTags = [...html.matchAll(/[ \t]*<link[^>]*rel="stylesheet"[^>]*>\n?/g)]
        .map(m => ({ tag: m[0], href: (m[0].match(/href="([^"]+)"/) || [])[1] }))
        .filter(t => t.href && isLocal(t.href));

    if (cssTags.length > 1) {
        // Named for the exact set of files it contains. A single shared
        // "bundle.css" meant the last page built overwrote the others — and
        // the content pages link a shorter list than index.html, so index
        // silently lost every style unique to it.
        const key = cssTags.map(t => path.basename(bare(t.href), '.css')).join('-');
        const file = `bundle-${key}.css`;

        const css = cssTags
            .map(t => fs.readFileSync(resolve(t.href), 'utf8'))
            .join('\n');
        fs.writeFileSync(path.join(DIST, 'css', file), css);

        const rel = path.relative(pageDir, path.join(DIST, 'css', file)).replace(/\\/g, '/');
        html = html.replace(cssTags[0].tag, `    <link rel="stylesheet" href="${rel}?v=${stamp(css)}">\n`);
        for (const t of cssTags.slice(1)) html = html.replace(t.tag, '');
    }

    // ── scripts ──────────────────────────────────────────────────
    const jsTags = [...html.matchAll(/[ \t]*<script[^>]*src="([^"]+)"[^>]*><\/script>\n?/g)]
        .map(m => ({ tag: m[0], src: m[1] }))
        .filter(t => isLocal(t.src));

    if (jsTags.length > 1) {
        // One file per page-set, named for the scripts it contains, so two
        // pages with different script lists never overwrite each other.
        const key = jsTags.map(t => path.basename(bare(t.src), '.js')).join('-');
        const file = `bundle-${key}.js`;
        const js = jsTags
            .map(t => fs.readFileSync(resolve(t.src), 'utf8'))
            .join('\n;\n');
        fs.writeFileSync(path.join(DIST, 'js', file), js);

        const rel = path.relative(pageDir, path.join(DIST, 'js', file)).replace(/\\/g, '/');
        html = html.replace(jsTags[0].tag, `    <script src="${rel}?v=${stamp(js)}" defer></script>\n`);
        for (const t of jsTags.slice(1)) html = html.replace(t.tag, '');
    }

    fs.writeFileSync(htmlPath, html);
    return { css: cssTags.length, js: jsTags.length };
}

(async () => {
    console.log('Building dist/ …\n');
    rmrf(DIST);
    fs.mkdirSync(DIST, { recursive: true });

    for (const entry of COPY) {
        const from = path.join(ROOT, entry);
        if (!fs.existsSync(from)) {
            console.warn(`  ! skipped missing ${entry}`);
            continue;
        }
        copyRecursive(from, path.join(DIST, entry));
    }

    const css = await minifyDir('css', 'css');
    const js = await minifyDir('js', 'js');

    // Bundle after minifying, so the bundles are built from minified sources.
    const pages = [path.join(DIST, 'index.html')];
    const pagesDir = path.join(DIST, 'pages');
    if (fs.existsSync(pagesDir)) {
        for (const f of fs.readdirSync(pagesDir)) {
            if (f.endsWith('.html')) pages.push(path.join(pagesDir, f));
        }
    }
    let savedRequests = 0;
    for (const p of pages) {
        const { css: c, js: j } = bundlePage(p);
        savedRequests += Math.max(0, c - 1) + Math.max(0, j - 1);
    }
    console.log(`  bundled ${pages.length} pages — ${savedRequests} fewer requests\n`);

    const saved = (css.before + js.before) - (css.after + js.after);
    const pct = (saved / (css.before + js.before) * 100).toFixed(1);

    console.log(`  CSS   ${kb(css.before).padStart(9)}  ->  ${kb(css.after).padStart(9)}`);
    console.log(`  JS    ${kb(js.before).padStart(9)}  ->  ${kb(js.after).padStart(9)}`);
    console.log(`  ${'-'.repeat(38)}`);
    console.log(`  saved ${kb(saved)}  (${pct}% smaller)\n`);
    console.log('Deploy the contents of dist/.');
})().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
