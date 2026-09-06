/**
 * ============================================================
 * SHARED PRODUCT LINKS  (?product=<id>)
 * ============================================================
 * The reported symptom: a shared product link opens the product
 * on a desktop and only the homepage on a phone.
 *
 * The handler was the last statement in initApp(), behind
 * `await loadInitialData()`. Everything before it had to
 * succeed first — categories, subcategories, posters, brands
 * and the first page of products. One rejection anywhere in
 * that chain and initApp() gave up before ever reading
 * ?product=, leaving the visitor on the homepage with no
 * product and no error. A phone on mobile data loses a request
 * far more often than a desktop on wifi, which is exactly the
 * difference between "works on desktop" and "just shows the
 * site on mobile".
 *
 * So these tests break the things a phone breaks.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM } = require('jsdom');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

jest.setTimeout(30000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PRODUCT = {
    _id: 'P42',
    name: 'Shared Kente Chair',
    price: 900,
    offerPrice: 750,
    images: [{ url: 'chair.png' }]
};

/**
 * Boots index.html at `url`. `respond` returns a body for each request, or
 * throws to simulate a request that never arrives.
 */
function boot(url, respond) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;

    const calls = [];
    win.fetch = async (u, opts = {}) => {
        const call = { url: String(u), method: opts.method || 'GET' };
        calls.push(call);
        const out = respond(call);          // may throw — that is the point
        const status = (out && out.__status) || 200;
        return { ok: status < 400, status, json: async () => out };
    };

    win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
    win.scrollTo = () => { };
    win.navigator.vibrate = () => true;
    win.Element.prototype.scrollIntoView = () => { };

    win.eval(['js/api.js', 'js/app.js', 'js/mobile-app.js', 'js/modern-home.js']
        .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));

    win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    return { win, doc: win.document, calls };
}

const isOpen = (doc) => !doc.getElementById('productDetailModal').hidden;
const productOk = () => ({ success: true, data: PRODUCT });
const listOk = () => ({ success: true, data: [{ _id: 'X1', name: 'Something else', price: 5 }], total: 1 });

function healthy(call) {
    if (/\/products\/P42/.test(call.url)) return productOk();
    if (call.url.includes('/products?')) return listOk();
    return { success: true, data: [] };
}

describe('a shared product link opens the product', () => {

    test.each([
        ['https://glomek.com/index.html?product=P42', '/index.html'],
        ['https://glomek.com/?product=P42', '/'],
    ])('%s', async (url, expectedPath) => {
        const { doc, win } = boot(url, healthy);
        await sleep(700);

        expect(isOpen(doc)).toBe(true);
        expect(doc.getElementById('productDetailModal').textContent).toContain('Shared Kente Chair');

        // Cleaned only after it actually opened, so a refresh does not reopen it.
        expect(win.location.pathname).toBe(expectedPath);
        expect(win.location.search).toBe('');
    });

    test('it opens even when loading the homepage fails outright', async () => {
        // What a phone does: the catalogue request never arrives. Before, this
        // rejected initApp() and ?product= was never read at all.
        const { doc } = boot('https://glomek.com/index.html?product=P42', (call) => {
            if (/\/products\/P42/.test(call.url)) return productOk();
            if (call.url.includes('/products?')) throw new Error('network gone');
            if (call.url.includes('/categories')) throw new Error('network gone');
            return { success: true, data: [] };
        });
        await sleep(900);

        expect(isOpen(doc)).toBe(true);
        expect(doc.getElementById('productDetailModal').textContent).toContain('Shared Kente Chair');
    });

    test('it does not wait for the catalogue before asking for the product', async () => {
        const { calls } = boot('https://glomek.com/index.html?product=P42', healthy);
        await sleep(700);

        const byId = calls.findIndex(c => /\/products\/P42/.test(c.url));
        const listing = calls.findIndex(c => c.url.includes('/products?'));
        expect(byId).toBeGreaterThan(-1);
        expect(listing).toBeGreaterThan(-1);
        // The product the visitor actually asked for goes out first.
        expect(byId).toBeLessThan(listing);
    });

    test('one dropped request is retried rather than reported as missing', async () => {
        let hits = 0;
        const { doc, calls } = boot('https://glomek.com/index.html?product=P42', (call) => {
            if (/\/products\/P42/.test(call.url)) {
                hits++;
                if (hits === 1) throw new Error('flaky mobile radio');
                return productOk();
            }
            if (call.url.includes('/products?')) return listOk();
            return { success: true, data: [] };
        });
        await sleep(1200);

        expect(calls.filter(c => /\/products\/P42/.test(c.url)).length).toBeGreaterThanOrEqual(2);
        expect(isOpen(doc)).toBe(true);
    });

    test('a link that cannot be opened keeps its id so a refresh retries', async () => {
        const { doc, win } = boot('https://glomek.com/index.html?product=P42', (call) => {
            if (/\/products\/P42/.test(call.url)) return { __status: 404, success: false };
            if (call.url.includes('/products?')) return listOk();
            return { success: true, data: [] };
        });
        await sleep(1200);

        expect(isOpen(doc)).toBe(false);
        // The id used to be wiped before the fetch, so a refresh could not retry.
        expect(win.location.search).toBe('?product=P42');
        expect(doc.getElementById('toastContainer').textContent).toMatch(/couldn't open that product/i);
    });

    test('an ordinary visit is untouched', async () => {
        const { doc, calls } = boot('https://glomek.com/index.html', healthy);
        await sleep(700);

        expect(isOpen(doc)).toBe(false);
        expect(calls.some(c => /\/products\/P42/.test(c.url))).toBe(false);
    });
});

describe('the link a share produces', () => {

    test('is the preview endpoint for that product, with no listing state', async () => {
        // Sharing from a search results page must not carry ?q= along.
        //
        // The link points at the API, not this page: crawlers build their
        // preview from the HTML at the URL and this site renders in JS, so a
        // shared ?product= link produced the site-wide card every time.
        const { win, doc } = boot('https://glomek.com/index.html?q=chair', healthy);
        await sleep(700);

        let shared = null;
        win.navigator.share = async (data) => { shared = data; };

        win.__setPdProduct
            ? win.__setPdProduct(PRODUCT)
            : await win.openProductDetails('P42');
        await sleep(300);

        await win.shareCurrentProduct();

        expect(shared).not.toBeNull();
        expect(shared.url).toBe('https://api.glomek.com/p/P42');
        expect(shared.url).not.toContain('q=chair');
    });
});
