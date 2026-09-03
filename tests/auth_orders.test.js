/**
 * ============================================================
 * SESSION SURVIVAL — orders page + paid-order recovery
 * ============================================================
 * Two failures shared one cause: the JWT lived in a plain
 * variable, so it did not exist after a navigation.
 *
 *   • pages/orders.html always said "log in on the main store",
 *     because it hunted for a glomek_token cookie that belongs
 *     to api.glomek.com and is unreadable from glomek.com.
 *
 *   • Returning from Paystack's hosted page reloads index.html.
 *     verify needs no auth and passed; POST /orders then went
 *     out with no token, answered 401, and the customer was
 *     told "Payment received but the order failed to save".
 *
 * These tests navigate for real — a second JSDOM sharing the
 * first one's storage — because that is the only way the bug
 * shows up.
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

const USER = { _id: 'u1', name: 'Apostle Seth', email: 'seth@example.com' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** A storage that outlives a single JSDOM, the way a browser's does. */
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        get length() { return map.size; },
        key: (i) => { const ks = [...map.keys()]; return i < ks.length ? ks[i] : null; }
    };
}

function attachStorage(win, session, local) {
    Object.defineProperty(win, 'sessionStorage', { value: session, configurable: true });
    Object.defineProperty(win, 'localStorage', { value: local, configurable: true });
}

/**
 * Boots a document with the real scripts.
 * `respond` is the network: (call) => body object. A `__status`
 * of 401/500 on the body drives the HTTP status.
 */
function boot({ page, scripts, session, local, respond }) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://glomek.com/' + page,
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const win = dom.window;
    attachStorage(win, session, local);

    const calls = [];
    win.fetch = async (url, opts = {}) => {
        const call = {
            url: String(url),
            method: opts.method || 'GET',
            headers: opts.headers || {},
            body: opts.body ? JSON.parse(opts.body) : null
        };
        calls.push(call);
        const out = respond(call) || { success: true, data: [] };
        const status = out.__status || 200;
        return { ok: status < 400, status, json: async () => out };
    };

    win.navigator.vibrate = () => true;
    win.scrollTo = () => { };
    win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };

    win.eval(scripts.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));

    return { win, doc: win.document, calls };
}

const authHeader = (call) => call.headers.Authorization || call.headers.authorization;

describe('the session survives a navigation', () => {

    test('logging in puts the token somewhere the next page can read', async () => {
        const session = makeStorage();
        const local = makeStorage();

        const { win, doc } = boot({
            page: 'index.html',
            scripts: ['js/api.js', 'js/app.js'],
            session, local,
            respond: (c) => {
                if (c.url.includes('login-user')) {
                    return { success: true, message: 'ok', token: 'jwt-abc-123', data: USER };
                }
                // This server does NOT accept the cookie on its own, so the
                // fallback has to survive. The two tests below cover the
                // opposite case, where the cookie wins and the token is
                // thrown away.
                if (c.url.includes('orderByUserId') && !authHeader(c)) {
                    return { __status: 401, message: 'No token provided' };
                }
                return { success: true, data: [] };
            }
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(200);

        doc.getElementById('authEmail').value = USER.email;
        doc.getElementById('authPassword').value = 'hunter2';
        await win.handleAuthSubmit({ preventDefault() { } });
        await sleep(200);

        // Not a cookie — api.glomek.com's cookie is invisible to this origin.
        expect(session.getItem('glomek_token')).toBe('jwt-abc-123');
        expect(JSON.parse(local.getItem('glomek_user'))._id).toBe('u1');
    });

    test('pages/orders.html lists orders instead of asking you to log in', async () => {
        const session = makeStorage({ glomek_token: 'jwt-abc-123' });
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc, calls } = boot({
            page: 'pages/orders.html',
            scripts: ['js/api.js', 'js/orders.js'],
            session, local,
            respond: () => ({
                success: true,
                data: [{
                    _id: 'order000111222',
                    createdAt: '2026-08-01T10:00:00Z',
                    orderStatus: 'delivered',
                    totalPrice: 320,
                    items: [{ productName: 'Kente Shirt', quantity: 2, price: 120 }]
                }]
            })
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(300);

        const text = doc.querySelector('.page-content-card').textContent;
        expect(text).not.toMatch(/log in on the main store/i);
        expect(text).toContain('Kente Shirt');
        expect(text).toMatch(/delivered/i);

        // And it authenticated the way the API actually expects.
        const fetchCall = calls.find(c => c.url.includes('orderByUserId'));
        expect(authHeader(fetchCall)).toBe('Bearer jwt-abc-123');
    });

    test('a 401 says the session expired, not "no orders yet"', async () => {
        const session = makeStorage({ glomek_token: 'stale' });
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc } = boot({
            page: 'pages/orders.html',
            scripts: ['js/api.js', 'js/orders.js'],
            session, local,
            respond: () => ({ __status: 401, message: 'No token provided' })
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(300);

        const text = doc.querySelector('.page-content-card').textContent;
        expect(text).toMatch(/session has expired/i);
        expect(text).not.toMatch(/placed any orders/i);
    });

    test('no token means no Authorization header, not "Bearer null"', async () => {
        const session = makeStorage();
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc, calls } = boot({
            page: 'pages/orders.html',
            scripts: ['js/api.js', 'js/orders.js'],
            session, local,
            respond: () => ({ __status: 401, message: 'No token provided' })
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(300);

        const fetchCall = calls.find(c => c.url.includes('orderByUserId'));
        expect(fetchCall).toBeDefined();
        expect(authHeader(fetchCall)).toBeUndefined();
    });
});

describe('a paid order is never lost', () => {

    /** The state Paystack's hosted page leaves behind on the way out. */
    function pendingSeed(reference) {
        return {
            glomek_token: 'jwt-abc-123',
            glomek_pending_order: JSON.stringify({
                reference,
                returnUrl: 'https://glomek.com/index.html',
                orderData: {
                    userID: 'u1',
                    orderStatus: 'pending',
                    items: [{ productID: 'p1', productName: 'Kente Shirt', quantity: 2, price: 120 }],
                    totalPrice: 240,
                    shippingAddress: { phone: '0244000000', street: '12 Oxford St', city: 'Accra', country: 'Ghana' },
                    paymentMethod: 'paystack_momo',
                    couponCode: null,
                    orderTotal: { subtotal: 240, discount: 0, total: 240 }
                }
            })
        };
    }

    test('returning from the hosted page sends the order WITH its token', async () => {
        const ref = 'GLOMEK_1788368993916_lgwvuif';
        const session = makeStorage(pendingSeed(ref));
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc, calls } = boot({
            page: 'index.html',
            scripts: ['js/api.js', 'js/app.js'],
            session, local,
            respond: (c) => {
                if (c.url.includes('paystack/verify')) return { success: true, data: { status: 'success' } };
                if (c.url.endsWith('/orders') && c.method === 'POST') {
                    // The real server: no header, no order.
                    if (!authHeader(c)) return { __status: 401, message: 'No token provided' };
                    return { success: true, data: { _id: 'order999' } };
                }
                return { success: true, data: [] };
            }
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(900);

        const create = calls.find(c => c.url.endsWith('/orders') && c.method === 'POST');
        expect(create).toBeDefined();
        expect(authHeader(create)).toBe('Bearer jwt-abc-123');
        expect(create.body.paymentId).toBe(ref);

        // Saved, so nothing is left parked.
        expect(JSON.parse(local.getItem('glomek_unsaved_paid_orders') || '[]')).toHaveLength(0);
    });

    test('an order the API rejects is kept, with the reason surfaced', async () => {
        const ref = 'GLOMEK_1788368993917_zzz';
        const session = makeStorage(pendingSeed(ref));
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc } = boot({
            page: 'index.html',
            scripts: ['js/api.js', 'js/app.js'],
            session, local,
            respond: (c) => {
                if (c.url.includes('paystack/verify')) return { success: true, data: { status: 'success' } };
                if (c.url.endsWith('/orders') && c.method === 'POST') return { __status: 500, message: 'Database unavailable' };
                return { success: true, data: [] };
            }
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(900);

        const parked = JSON.parse(local.getItem('glomek_unsaved_paid_orders') || '[]');
        expect(parked).toHaveLength(1);
        expect(parked[0].reference).toBe(ref);
        expect(parked[0].payload.paymentId).toBe(ref);

        // The customer is told why, not just "contact support".
        expect(doc.getElementById('toastContainer').textContent).toContain('Database unavailable');
    });

    test('the next visit retries the parked order and clears it', async () => {
        const ref = 'GLOMEK_1788368993918_yyy';
        const session = makeStorage({ glomek_token: 'jwt-abc-123' });
        const local = makeStorage({
            glomek_user: JSON.stringify(USER),
            // Parked on an earlier visit, so past the 30s cool-off.
            glomek_unsaved_paid_orders: JSON.stringify([{
                reference: ref,
                parkedAt: Date.now() - 600000,
                attempts: 1,
                payload: { userID: 'u1', totalPrice: 240, paymentId: ref, items: [] }
            }])
        });

        const { win, doc, calls } = boot({
            page: 'index.html',
            scripts: ['js/api.js', 'js/app.js'],
            session, local,
            respond: (c) => (c.url.endsWith('/orders') && c.method === 'POST')
                ? { success: true, data: { _id: 'orderLate' } }
                : { success: true, data: [] }
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(900);

        const create = calls.find(c => c.url.endsWith('/orders') && c.method === 'POST');
        expect(create).toBeDefined();
        expect(create.body.paymentId).toBe(ref);
        expect(JSON.parse(local.getItem('glomek_unsaved_paid_orders'))).toHaveLength(0);
        expect(doc.getElementById('toastContainer').textContent).toMatch(/earlier paid order/i);
    });

    test("the JS token is discarded once the HttpOnly cookie is proven", async () => {
        const session = makeStorage({ glomek_token: "jwt-abc-123" });
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc, calls } = boot({
            page: "index.html",
            scripts: ["js/api.js", "js/app.js"],
            session, local,
            // The server accepts the cookie, so a call with no header still 200s.
            respond: () => ({ success: true, data: [] })
        });

        doc.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
        await sleep(900);

        // The probe deliberately withholds the header.
        const probe = calls.find(c => c.url.includes("orderByUserId") && !authHeader(c));
        expect(probe).toBeDefined();

        // Cookie works, so nothing is left in JS storage.
        expect(session.getItem("glomek_token")).toBeNull();
    });

    test("the JS token is kept when the cookie does NOT authenticate", async () => {
        const session = makeStorage({ glomek_token: "jwt-abc-123" });
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc } = boot({
            page: "index.html",
            scripts: ["js/api.js", "js/app.js"],
            session, local,
            // No header, no entry — the production behaviour before the cookie
            // name was corrected.
            respond: (c) => c.url.includes("orderByUserId") && !authHeader(c)
                ? { __status: 401, message: "No token provided" }
                : { success: true, data: [] }
        });

        doc.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
        await sleep(900);

        // Checkout must keep working, so the fallback stays.
        expect(session.getItem("glomek_token")).toBe("jwt-abc-123");
    });

    test('logging out clears the token', async () => {
        const session = makeStorage({ glomek_token: 'jwt-abc-123' });
        const local = makeStorage({ glomek_user: JSON.stringify(USER) });

        const { win, doc } = boot({
            page: 'index.html',
            scripts: ['js/api.js', 'js/app.js'],
            session, local,
            respond: () => ({ success: true, data: [] })
        });

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(200);

        await win.logout();
        expect(session.getItem('glomek_token')).toBeNull();
        expect(local.getItem('glomek_user')).toBeNull();
    });
});
