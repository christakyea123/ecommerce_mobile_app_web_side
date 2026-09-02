/**
 * ============================================================
 * CROSS-PLATFORM DESIGN TOKENS
 * ============================================================
 * The web and the Flutter app are one brand. This reads the
 * colour constants out of the Flutter source and asserts the
 * web CSS variables still match, so the two cannot silently
 * drift apart when either side is edited.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

const FLUTTER_COLORS = path.resolve(
    __dirname, '..', '..',
    'client_side/flutter_ecommerce/lib/utility/app_color.dart'
);

/** `static const darkOrange = Color(0xFFFF9C08);` -> '#ff9c08' */
function flutterColor(name) {
    const src = fs.readFileSync(FLUTTER_COLORS, 'utf8');
    const m = src.match(new RegExp(`${name}\\s*=\\s*Color\\(0x([0-9A-Fa-f]{8})\\)`));
    if (!m) throw new Error(`AppColor.${name} not found in ${FLUTTER_COLORS}`);
    return '#' + m[1].slice(2).toLowerCase(); // drop the alpha byte
}

function cssVar(name) {
    const src = fs.readFileSync(path.join(ROOT, 'css/variables.css'), 'utf8');
    const m = src.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim().toLowerCase() : null;
}

const describeIfFlutter = fs.existsSync(FLUTTER_COLORS) ? describe : describe.skip;

describeIfFlutter('🎨 Web ↔ Flutter design tokens', () => {

    test('the cart count badge is the same colour as the mobile app', () => {
        // AppColor.darkOrange is what the Flutter bottom-nav cart badge uses
        // (client_side/.../screen/home_screen.dart).
        expect(cssVar('badge-bg')).toBe(flutterColor('darkOrange'));
    });

    test('the brand accent matches AppColor.jumiaOrange', () => {
        expect(cssVar('accent-color')).toBe(flutterColor('jumiaOrange'));
    });

    test('the tinted accent matches AppColor.lightJumiaOrange', () => {
        expect(cssVar('accent-light')).toBe(flutterColor('lightJumiaOrange'));
    });

    test('every count badge uses the shared token, not a hardcoded colour', () => {
        const files = ['navbar.css', 'components.css', 'modals.css', 'mobile-app.css'];
        const offenders = [];

        for (const f of files) {
            // Strip comments first, or comment prose containing the word
            // "badge" gets read as part of the next rule's selector.
            const src = fs.readFileSync(path.join(ROOT, 'css', f), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '');

            // Pull each rule whose selector mentions a count badge.
            for (const m of src.matchAll(/([^{}]*badge[^{}]*)\{([^}]*)\}/gi)) {
                const [, selector, body] = m;
                if (/trust-badge|order-status-badge|badge-pop|discount/i.test(selector)) continue;
                const bg = body.match(/background:\s*([^;]+);/);
                if (bg && !bg[1].includes('--badge-bg')) {
                    offenders.push(`${f}: ${selector.trim()} -> ${bg[1].trim()}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
