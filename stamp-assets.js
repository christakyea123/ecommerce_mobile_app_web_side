#!/usr/bin/env node
/**
 * ============================================================
 * GLOMEK ASSET STAMPER
 * ============================================================
 * Rewrites every local css/js reference in the HTML to carry a
 * ?v=<content hash>, so a deployed change actually reaches the
 * browsers that already have the old file.
 *
 *   npm run stamp
 *
 * Why this exists
 * ---------------
 * glomek.com serves stylesheets with
 *
 *     cache-control: public, max-age=604800
 *
 * — seven days — and the links carried no version. A returning
 * visitor therefore kept using last week's CSS against this
 * week's HTML, for up to a week, with no way to know. That is
 * how a fix that was verifiably live on the server still showed
 * the old broken layout in the browser: the call-to-order strip
 * was being positioned by a stylesheet that no longer existed
 * on the server.
 *
 * The hash is over the file's bytes, so the URL changes when and
 * only when the file does. Unchanged files keep their long cache
 * life, which is the point of max-age in the first place.
 *
 * Run it after editing css/ or js/ and before deploying; `npm
 * run build` runs it for you.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

/** Eight hex characters is plenty to tell two builds apart. */
function hashOf(file) {
    return crypto.createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex')
        .slice(0, 8);
}

/** Every .html in the project root and in pages/. */
function htmlFiles() {
    const out = fs.readdirSync(ROOT)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(ROOT, f));

    const pages = path.join(ROOT, 'pages');
    if (fs.existsSync(pages)) {
        for (const f of fs.readdirSync(pages)) {
            if (f.endsWith('.html')) out.push(path.join(pages, f));
        }
    }
    return out;
}

// href="css/x.css"  href="../css/x.css"  src="js/x.js"  src="../js/x.js"
// — with or without a ?v= already on it. Absolute URLs never match, because
// the path may not begin with a scheme or a slash.
const ASSET_REF = /(href|src)="((?:\.\.\/)?(?:css|js)\/[A-Za-z0-9_.-]+\.(?:css|js))(\?v=[A-Za-z0-9]+)?"/g;

function stamp() {
    const hashes = new Map();
    let filesChanged = 0;
    let refsStamped = 0;
    const missing = new Set();

    for (const htmlPath of htmlFiles()) {
        const original = fs.readFileSync(htmlPath, 'utf8');

        const updated = original.replace(ASSET_REF, (whole, attr, assetPath) => {
            // Resolve relative to the HTML file, the way the browser does.
            const onDisk = path.resolve(path.dirname(htmlPath), assetPath);
            if (!fs.existsSync(onDisk)) {
                missing.add(path.relative(ROOT, htmlPath) + ' -> ' + assetPath);
                return whole; // leave a broken link visible rather than stamping it
            }
            if (!hashes.has(onDisk)) hashes.set(onDisk, hashOf(onDisk));
            refsStamped++;
            return `${attr}="${assetPath}?v=${hashes.get(onDisk)}"`;
        });

        if (updated !== original) {
            fs.writeFileSync(htmlPath, updated);
            filesChanged++;
        }
    }

    console.log(`\n  stamped ${refsStamped} references across ${htmlFiles().length} pages`);
    console.log(`  ${filesChanged} file(s) rewritten, ${hashes.size} distinct assets\n`);

    if (missing.size) {
        console.warn('  referenced but not on disk:');
        for (const m of missing) console.warn('    ' + m);
        console.warn('');
    }
}

stamp();
