/**
 * ============================================================
 * CONTENT SECURITY POLICY
 * ============================================================
 * A CSP that blocks a resource the site genuinely needs is an
 * outage, so this checks the policy against BOTH:
 *
 *   1. resources declared in the HTML, and
 *   2. resources the third-party scripts inject at RUNTIME —
 *      which never appear in the markup and are the ones that
 *      actually broke in the browser.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

function parseCSP(html) {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([\s\S]*?)"\s*>/);
    if (!m) return null;
    const policy = {};
    m[1].split(';').map(s => s.trim()).filter(Boolean).forEach(d => {
        const [name, ...vals] = d.split(/\s+/);
        policy[name] = vals;
    });
    return policy;
}

function allows(policy, directive, origin) {
    // CSP falls back to default-src only for directives that are absent.
    const list = policy[directive] || policy['default-src'] || [];
    return list.includes(origin) || list.includes('https:');
}

const PAGES = ['index.html', ...fs.readdirSync(path.join(ROOT, 'pages'))
    .filter(f => f.endsWith('.html')).map(f => 'pages/' + f)];

/**
 * Origins fetched by third-party SDKs after they boot. None of these appear
 * in the HTML — each one here was a real blocked request in Chrome.
 */
const RUNTIME_ORIGINS = [
    ['style-src', 'https://accounts.google.com', 'Google Sign-In injects /gsi/style'],
    ['style-src', 'https://paystack.com', 'Paystack inline injects /public/css/button.min.css'],
    ['script-src', 'https://accounts.google.com', 'Google Identity Services client'],
    ['script-src', 'https://js.paystack.co', 'Paystack inline'],
    ['connect-src', 'https://api.glomek.com', 'ApiService fetch'],
    ['connect-src', 'https://api.paystack.co', 'Paystack verify'],
    ['connect-src', 'https://accounts.google.com', 'Google token exchange'],
    ['frame-src', 'https://checkout.paystack.com', 'Paystack payment iframe'],
    ['frame-src', 'https://accounts.google.com', 'Google Sign-In iframe'],
    ['font-src', 'https://fonts.gstatic.com', 'Google font files'],
];

describe('🔒 Content Security Policy', () => {

    test('every page carries a CSP', () => {
        const missing = PAGES.filter(p => !parseCSP(fs.readFileSync(path.join(ROOT, p), 'utf8')));
        expect(missing).toEqual([]);
    });

    test('every page allows the resources declared in its own markup', () => {
        const blocked = [];

        for (const page of PAGES) {
            const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
            const policy = parseCSP(html);
            if (!policy) continue;

            const resources = [];
            for (const m of html.matchAll(/<script[^>]*src="(https?:\/\/[^"]+)"/g)) {
                resources.push(['script-src', m[1]]);
            }
            for (const m of html.matchAll(/<link[^>]*(?:rel="stylesheet"[^>]*href|href[^>]*rel="stylesheet")/g)) {
                const href = m[0].match(/href="(https?:\/\/[^"]+)"/);
                if (href) resources.push(['style-src', href[1]]);
            }

            for (const [directive, url] of resources) {
                const origin = new URL(url).origin;
                if (!allows(policy, directive, origin)) {
                    blocked.push(`${page}: ${directive} blocks ${origin}`);
                }
            }
        }

        expect(blocked).toEqual([]);
    });

    test('the policy allows what the third-party SDKs load at runtime', () => {
        const policy = parseCSP(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
        const blocked = RUNTIME_ORIGINS
            .filter(([directive, origin]) => !allows(policy, directive, origin))
            .map(([directive, origin, why]) => `${directive} blocks ${origin} (${why})`);

        expect(blocked).toEqual([]);
    });

    test('the policy still forbids the things that make XSS pay off', () => {
        const policy = parseCSP(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));

        // Plugins off, <base> not hijackable.
        expect(policy['object-src']).toEqual(["'none'"]);
        expect(policy['base-uri']).toEqual(["'self'"]);

        // A wildcard here would let an attacker load or exfiltrate anywhere.
        expect(policy['script-src']).not.toContain('*');
        expect(policy['script-src']).not.toContain('https:');
        expect(policy['connect-src']).not.toContain('*');
        expect(policy['connect-src']).not.toContain('https:');

        // 'unsafe-eval' is never needed here and would re-open string-to-code.
        expect(policy['script-src']).not.toContain("'unsafe-eval'");
    });
});
