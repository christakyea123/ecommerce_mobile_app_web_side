/**
 * ============================================================
 * PAGINATION — products, and the reference lists behind them
 * ============================================================
 * Products were genuinely paginated: PAGE_SIZE of 40, real page
 * numbers built from the API's `total`, and the page carried in
 * the address bar.
 *
 * The lists that feed the page were not. Each was one fixed
 * fetch with a hardcoded ceiling — categories at limit=20,
 * posters at limit=5, subCategories at the default limit=10,
 * brands at 50 — and none of them read `total`. Nothing failed
 * when a list outgrew its number; the extra rows just stopped
 * appearing on the site. Production had 7 subcategories against
 * a limit of 10 and 30 brands against 50.
 *
 * These tests serve more rows than any of those old ceilings.
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

/** A paginated collection, served the way api.glomek.com serves one. */
function collection(count, prefix) {
    const all = Array.from({ length: count }, (_, i) => ({
        _id: `${prefix}${i}`,
        name: `${prefix} ${i}`,
        image: 'x.png',
        images: [{ url: 'x.png' }],
        price: 100 + i
    }));
    return (url) => {
        const page = parseInt((url.match(/page=(\d+)/) || [])[1], 10) || 1;
        const limit = parseInt((url.match(/limit=(\d+)/) || [])[1], 10) || 10;
        const start = (page - 1) * limit;
        return { success: true, data: all.slice(start, start + limit), total: count, page, limit };
    };
}

function boot({ counts = {}, url = 'https://glomek.com/index.html' } = {}) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;

    const sets = {
        categories: collection(counts.categories ?? 4, 'cat'),
        subCategories: collection(counts.subCategories ?? 7, 'sub'),
        posters: collection(counts.posters ?? 3, 'pos'),
        brands: collection(counts.brands ?? 30, 'brand'),
        products: collection(counts.products ?? 10, 'prod')
    };

    const calls = [];
    win.fetch = async (u) => {
        const s = String(u);
        calls.push(s);
        for (const key of ['categories', 'subCategories', 'posters', 'brands']) {
            if (s.includes(`/${key}?`)) return { ok: true, status: 200, json: async () => sets[key](s) };
        }
        if (s.includes('/products?')) return { ok: true, status: 200, json: async () => sets.products(s) };
        return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
    };

    win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
    win.scrollTo = () => { };
    win.navigator.vibrate = () => true;
    win.Element.prototype.scrollIntoView = () => { };

    win.eval(['js/api.js', 'js/app.js', 'js/mobile-app.js', 'js/modern-home.js']
        .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
        + '\n;window.__state = state;window.__PAGE_SIZE = PAGE_SIZE;');

    // No manual DOMContentLoaded here. JSDOM fires its own once parsing
    // finishes, which is AFTER this synchronous eval — so app.js's listener
    // catches it. Dispatching as well booted the app twice and doubled every
    // request count below. A browser fires it once; so does this.
    return { win, doc: win.document, calls };
}

describe('reference lists are followed to the end', () => {

    test.each([
        ['posters', 40, 'the old fetch asked for 5'],
        ['categories', 55, 'the old fetch asked for 20'],
        ['subCategories', 64, 'the old fetch defaulted to 10'],
        ['brands', 120, 'the old fetch asked for 50'],
    ])('%s: all %i arrive (%s)', async (key, count) => {
        const { win } = boot({ counts: { [key]: count } });
        await sleep(1200);

        const stateKey = key === 'subCategories' ? 'subCategories' : key;
        expect(win.__state[stateKey]).toHaveLength(count);
    });

    test('a single page is fetched once, not paged needlessly', async () => {
        const { calls } = boot({ counts: { posters: 3 } });
        await sleep(1000);

        // 3 posters fit in one request; there is no reason to ask for page 2.
        expect(calls.filter(c => c.includes('/posters?')).length).toBe(1);
    });

    test('paging stops at the total rather than running to the guard', async () => {
        const { calls } = boot({ counts: { brands: 120 } });
        await sleep(1200);

        const brandCalls = calls.filter(c => c.includes('/brands?'));
        // 120 rows at 50 per page is three requests, and no more.
        expect(brandCalls).toHaveLength(3);
        expect(brandCalls.some(c => /page=4/.test(c))).toBe(false);
    });

    test('a server that ignores page cannot spin the loop', async () => {
        // Always answers with the same full first page and an inflated total.
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
        const win = dom.window;
        let posterCalls = 0;

        win.fetch = async (u) => {
            const s = String(u);
            if (s.includes('/posters?')) {
                posterCalls++;
                return {
                    ok: true, status: 200, json: async () => ({
                        success: true,
                        data: Array.from({ length: 20 }, (_, i) => ({ _id: 'p' + i, image: 'x.png' })),
                        total: 100000
                    })
                };
            }
            return { ok: true, status: 200, json: async () => ({ success: true, data: [], total: 0 }) };
        };
        win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
        win.scrollTo = () => { };
        win.navigator.vibrate = () => true;
        win.Element.prototype.scrollIntoView = () => { };
        win.eval(['js/api.js', 'js/app.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));
        await sleep(1500);

        expect(posterCalls).toBeGreaterThan(0);
        expect(posterCalls).toBeLessThanOrEqual(20); // the maxPages guard
    });
});

describe('product pagination', () => {

    test('page numbers come from the total, not from what arrived', async () => {
        const { win, doc } = boot({ counts: { products: 260 } });
        await sleep(1200);

        const size = win.__PAGE_SIZE;
        expect(win.__state.totalResults).toBe(260);

        const bar = doc.getElementById('paginationBar') || doc.querySelector('.pagination');
        expect(bar).not.toBeNull();
        expect(bar.hidden).toBe(false);

        // 260 at 40 a page is 7 pages; the last number shown must be 7.
        const last = Math.ceil(260 / size);
        expect(last).toBe(7);
        expect(bar.textContent).toContain(String(last));
    });

    test('hasMore is judged against PAGE_SIZE, not a hardcoded 50', async () => {
        // PAGE_SIZE is 40, so a full page returns 40 and the old
        // "40 >= 50" was false every time — hasMore was stuck false.
        const { win } = boot({ counts: { products: 260 } });
        await sleep(1200);

        expect(win.__state.products.length).toBe(win.__PAGE_SIZE);
        expect(win.__state.hasMore).toBe(true);
    });

    test('the last page reports no more', async () => {
        const { win } = boot({ counts: { products: 45 }, url: 'https://glomek.com/index.html?page=2' });
        await sleep(1200);

        expect(win.__state.currentPage).toBe(2);
        expect(win.__state.products.length).toBe(5);
        expect(win.__state.hasMore).toBe(false);
    });

    test('a listing that fits on one page shows no pagination bar', async () => {
        const { doc } = boot({ counts: { products: 12 } });
        await sleep(1200);

        const bar = doc.getElementById('paginationBar') || doc.querySelector('.pagination');
        if (bar) expect(bar.hidden).toBe(true);
    });

    test('the requested page reaches the API', async () => {
        const { calls } = boot({ counts: { products: 260 }, url: 'https://glomek.com/index.html?page=3' });
        await sleep(1200);

        const productCall = calls.find(c => c.includes('/products?'));
        expect(productCall).toMatch(/page=3/);
        expect(productCall).toMatch(/limit=40/);
    });
});
