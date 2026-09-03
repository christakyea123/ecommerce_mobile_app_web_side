/**
 * ============================================================
 * BUILD OUTPUT — the bundle the browser actually loads
 * ============================================================
 * The build collapses 11 stylesheets and 4 scripts into one of
 * each. These are classic scripts sharing a single global scope
 * (app.js declares `state`, mobile-app.js reads it), so a wrong
 * concatenation order breaks the site while every individual
 * file still passes its own tests.
 *
 * This boots dist/index.html the way a browser would: by reading
 * the bundle named in its own <script> tag.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM } = require('jsdom');

const DIST = path.resolve(__dirname, '..', 'dist');
const hasDist = fs.existsSync(path.join(DIST, 'index.html'));
const describeIfBuilt = hasDist ? describe : describe.skip;

/**
 * Every local reference carries a ?v=<content hash> so a deploy is not hidden
 * behind glomek.com's `cache-control: public, max-age=604800`. The stamp is
 * part of the URL, never of the path on disk, so anything that opens the file
 * has to drop it first.
 */
const bare = (ref) => ref.split('?')[0];

jest.setTimeout(30000);

describeIfBuilt('📦 Built bundle', () => {

    test('the page asks for one local stylesheet and one local script', () => {
        const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

        const localCss = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]
            .map(m => (m[0].match(/href="([^"]+)"/) || [])[1])
            .filter(h => h && !/^https?:|^\/\//.test(h));
        expect(localCss).toHaveLength(1);

        const localJs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
            .map(m => m[1])
            .filter(s => !/^https?:|^\/\//.test(s));
        expect(localJs).toHaveLength(1);
    });

    test('every bundled file the page references exists', () => {
        const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
        const refs = [
            ...[...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map(m => m[1]),
            ...[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]),
        ].filter(r => !/^https?:|^\/\//.test(r));

        const missing = refs.filter(r => !fs.existsSync(path.join(DIST, bare(r))));
        expect(missing).toEqual([]);
    });

    test('the bundle boots and renders products', async () => {
        const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
        const bundleSrc = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
            .map(m => m[1])
            .find(s => !/^https?:|^\/\//.test(s));
        expect(bundleSrc).toBeTruthy();

        const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
        const win = dom.window;

        win.fetch = async (url) => {
            if (String(url).includes('/products?')) {
                const data = Array.from({ length: 8 }, (_, i) => ({
                    _id: 'b' + i, name: 'Bundled ' + i, price: 100
                }));
                return { ok: true, json: async () => ({ success: true, data, total: 8 }) };
            }
            return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
        };
        win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
        win.scrollTo = () => { };
        win.navigator.vibrate = () => true;
        win.Element.prototype.scrollIntoView = () => { };

        // Exactly what the browser executes.
        win.eval(fs.readFileSync(path.join(DIST, bare(bundleSrc)), 'utf8'));
        win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // If concatenation order were wrong, the shared globals would be
        // undefined and nothing would render.
        expect(win.document.getElementById('productGrid').children.length).toBe(8);
        // mobile-app.js runs after app.js and depends on it.
        expect(win.document.getElementById('categoryDrawer')).not.toBeNull();
        expect(typeof win.openCategoryDrawer).toBe('function');
    });

    test("index.html's bundle contains the styles only index.html uses", () => {
        // Every page wrote to one shared bundle.css, so the last page built
        // overwrote the rest — and the content pages link a shorter list, so
        // index.html lost every style unique to it.
        const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
        const href = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]
            .map(m => (m[0].match(/href="([^"]+)"/) || [])[1])
            .find(h => h && !/^https?:|^\/\//.test(h));

        const css = fs.readFileSync(path.join(DIST, bare(href)), 'utf8');

        // Selectors that live only in modern.css, the last sheet index links.
        expect(css).toMatch(/\.listing-bar/);
        expect(css).toMatch(/\.pagination/);
        expect(css).toMatch(/\.cat-drawer/);

        // Cascade order preserved: variables.css first, modern.css last.
        expect(css.indexOf('--accent-color')).toBeGreaterThan(-1);
        expect(css.indexOf('--accent-color')).toBeLessThan(css.indexOf('.listing-bar'));

        // The reset that makes [hidden] authoritative must survive bundling.
        expect(css).toMatch(/\[hidden\]\[hidden\]/);
    });

    test('pages with different stylesheet sets get different bundles', () => {
        const read = (p) => fs.readFileSync(path.join(DIST, p), 'utf8');
        const localCss = (html, dir) => {
            const href = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]
                .map(m => (m[0].match(/href="([^"]+)"/) || [])[1])
                .find(h => h && !/^https?:|^\/\//.test(h));
            return path.posix.normalize(path.posix.join(dir, bare(href)));
        };

        const indexBundle = localCss(read('index.html'), '.');
        const pageBundle = localCss(read('pages/help.html'), 'pages');
        expect(indexBundle).not.toBe(pageBundle);
    });
});
