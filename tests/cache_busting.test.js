/**
 * ============================================================
 * CACHE BUSTING
 * ============================================================
 * glomek.com serves stylesheets with
 *
 *     cache-control: public, max-age=604800
 *
 * and the links used to carry no version at all. A returning
 * visitor therefore kept last week's CSS against this week's
 * HTML for up to seven days.
 *
 * That is not theoretical: a hero-spacing fix was verifiably
 * live on the server — `curl https://glomek.com/css/modern.css`
 * contained it — while the browser still rendered the old
 * layout and the call-to-order strip was still missing.
 *
 * So every local css/js reference must carry a ?v=<hash> of the
 * file's own bytes. `npm run stamp` writes them; `npm run build`
 * runs it first. If this test fails, the stamps are stale — run
 * the stamper and commit the result.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const hashOf = (file) =>
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

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

/** Local css/js references, with whatever query they carry. */
function localRefs(html) {
    const out = [];
    const re = /(?:href|src)="((?:\.\.\/)?(?:css|js)\/[^"]+\.(?:css|js)(?:\?[^"]*)?)"/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
}

describe('deploys reach the browser', () => {

    test('the project has pages and assets to check', () => {
        const pages = htmlFiles();
        expect(pages.length).toBeGreaterThan(1);

        const total = pages.reduce(
            (n, p) => n + localRefs(fs.readFileSync(p, 'utf8')).length, 0
        );
        expect(total).toBeGreaterThan(20);
    });

    test('every local css/js reference carries a ?v= stamp', () => {
        const unstamped = [];

        for (const page of htmlFiles()) {
            for (const ref of localRefs(fs.readFileSync(page, 'utf8'))) {
                if (!/\?v=[a-f0-9]{8}$/.test(ref)) {
                    unstamped.push(path.relative(ROOT, page) + ' -> ' + ref);
                }
            }
        }

        expect(unstamped).toEqual([]);
    });

    test('each stamp matches the file it points at', () => {
        const stale = [];

        for (const page of htmlFiles()) {
            const html = fs.readFileSync(page, 'utf8');
            for (const ref of localRefs(html)) {
                const [assetPath, query] = ref.split('?');
                const onDisk = path.resolve(path.dirname(page), assetPath);

                if (!fs.existsSync(onDisk)) {
                    stale.push(path.relative(ROOT, page) + ' -> ' + assetPath + ' (missing)');
                    continue;
                }
                const want = hashOf(onDisk);
                const got = (query || '').replace('v=', '');
                if (got !== want) {
                    stale.push(
                        path.relative(ROOT, page) + ' -> ' + assetPath +
                        ' has v=' + got + ', file hashes to ' + want
                    );
                }
            }
        }

        // Run `npm run stamp` if this fails.
        expect(stale).toEqual([]);
    });

    test('a changed file gets a different stamp', () => {
        // The whole mechanism rests on this: same bytes, same URL (so the long
        // max-age still does its job); different bytes, different URL.
        const target = path.join(ROOT, 'css', 'modern.css');
        const original = fs.readFileSync(target);
        const before = hashOf(target);

        try {
            fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n/* x */\n')]));
            expect(hashOf(target)).not.toBe(before);
        } finally {
            fs.writeFileSync(target, original);
        }

        expect(hashOf(target)).toBe(before);
    });
});
