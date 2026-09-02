/**
 * ============================================================
 * PRODUCT LOADING
 * ============================================================
 * Regression cover for the failure that left the grid showing
 * "Showing 0 products" with nothing to scroll:
 *
 *   1. IntersectionObserver delivers an initial callback for a
 *      newly observed target. With an empty grid the sentinel is
 *      on screen, so it fired while page 1 was still in flight.
 *   2. That ran a *pagination* load first, which spread
 *      `state.allProducts` — still undefined — and threw.
 *   3. The throw left `state.isLoading` true forever, so every
 *      later load hit `if (state.isLoading) return` and did
 *      nothing at all.
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

function boot({ products, observeImmediately = true, productDelay = 0, observeDelay = 0 }) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;

    const calls = [];
    win.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/products?')) {
            const page = parseInt((u.match(/page=(\d+)/) || [])[1], 10);
            calls.push(page);
            // Holding the response open reproduces the real window: the
            // observer fires while page 1 is still in flight.
            if (productDelay) await sleep(productDelay);
            return { ok: true, json: async () => ({ success: true, data: products(page) }) };
        }
        // Categories/posters/brands are awaited BEFORE the first product load.
        // They must be slow here too, or page 1 starts instantly and the race
        // window this test exists to cover never opens.
        if (productDelay) await sleep(productDelay);
        return { ok: true, json: async () => ({ success: true, data: [] }) };
    };

    // Stand-in for the real behaviour: a newly observed target always gets one
    // callback, delivered asynchronously shortly after observe().
    win.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe() {
            if (!observeImmediately) return;
            setTimeout(() => this.cb([{ isIntersecting: true }]), observeDelay);
        }
        unobserve() { }
        disconnect() { }
    };

    win.scrollTo = () => { };
    win.navigator.vibrate = () => true;

    const bundle = ['js/api.js', 'js/app.js']
        .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
        .join('\n;\n') + '\n;window.__state = state;';
    win.eval(bundle);

    return { win, doc: win.document, calls };
}

describe('🛒 Product loading', () => {

    test('an early observer callback cannot starve the first page', async () => {
        // Page 1 takes 150ms; the observer fires at 20ms, i.e. squarely while
        // the first load is still in flight. That is the exact race that
        // produced "Showing 0 products".
        const { win, doc, calls } = boot({
            productDelay: 150,
            observeDelay: 20,
            products: (page) => (page === 1
                ? Array.from({ length: 50 }, (_, i) => ({ _id: 'p' + i, name: 'Item ' + i, price: 10 }))
                : [])
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(900);

        // Page 1 must be requested, and must be the first request made.
        expect(calls).toContain(1);
        expect(calls[0]).toBe(1);
        // Page 2 must never be fetched before page 1 has landed.
        expect(calls.indexOf(2) === -1 || calls.indexOf(2) > calls.indexOf(1)).toBe(true);

        expect(win.__state.isLoading).toBe(false);
        expect(win.__state.products.length).toBeGreaterThan(0);
        expect(doc.getElementById('productGrid').children.length).toBeGreaterThan(0);
    });

    test('the loading flag always clears, even when a load throws', async () => {
        const { win, doc } = boot({ products: () => { throw new Error('boom'); } });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // A stuck flag is what made every later load a silent no-op.
        expect(win.__state.isLoading).toBe(false);
    });

    test('allProducts is initialised so a pagination-first load cannot throw', async () => {
        const { win } = boot({ products: () => [], observeImmediately: false });
        expect(Array.isArray(win.__state.allProducts)).toBe(true);
    });

    test('the page has real height once products render', async () => {
        const { win, doc } = boot({
            products: (page) => (page === 1
                ? Array.from({ length: 30 }, (_, i) => ({ _id: 'p' + i, name: 'Item ' + i, price: 10 }))
                : [])
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // "It does not scroll" was the page genuinely having no content.
        expect(doc.getElementById('productGrid').children.length).toBe(30);
        expect(doc.getElementById('productCountText').textContent).not.toMatch(/\b0\b/);
    });
});
