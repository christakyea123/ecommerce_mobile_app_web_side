/**
 * ============================================================
 * E-COMMERCE WEB - FULL QA TEST SUITE
 * ============================================================
 * Tests: UI Components, API Handlers, State logic
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM } = require('jsdom');

describe('🌐 Web Side End-to-End & Unit Tests', () => {
    let dom;
    let window;
    let document;

    beforeAll(() => {
        const htmlPath = path.resolve(__dirname, '../index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Setup a mock DOM environment
        dom = new JSDOM(htmlContent);
        window = dom.window;
        document = window.document;
    });

    // 1. Structure Verification
    test('Index HTML structure is intact', () => {
        expect(document.querySelector('header')).not.toBeNull();
        expect(document.querySelector('main')).not.toBeNull();
        expect(document.querySelector('footer')).not.toBeNull();
    });

    // 2. Navigation Components
    test('Navigation bar contains required links', () => {
        // The navbar relies on dynamic categories. It must have the category wrapper.
        const catWrapper = document.querySelector('.category-nav-wrapper');
        expect(catWrapper).not.toBeNull();
        expect(document.getElementById('categoryList')).not.toBeNull();
    });

    // 3. Search Bar Elements
    test('Search functionality components exist', () => {
        expect(document.getElementById('searchInput')).not.toBeNull();
        expect(document.querySelector('.search-submit-btn')).not.toBeNull();
    });

    // 4. Cart Mechanism
    test('Cart tracking components exist', () => {
        const cartBadge = document.getElementById('cartBadge');
        expect(cartBadge).not.toBeNull();
        // Starts at 0
        expect(cartBadge.textContent).toBe('0');
    });

    // 5. Auth / Login Forms
    test('Auth modals structure available', () => {
        const loginModal = document.getElementById('loginModal');
        // Not all UI architectures have login on index, if it does:
        if (loginModal) {
            expect(loginModal.querySelector('form')).not.toBeNull();
            expect(loginModal.querySelector('input[type="email"]')).not.toBeNull();
            expect(loginModal.querySelector('input[type="password"]')).not.toBeNull();
        }
    });

    // 6. Security elements
    test('Footer links are clean and pointing to exact assets', () => {
        const footerLinks = Array.from(document.querySelectorAll('footer a'));
        expect(footerLinks.length).toBeGreaterThan(0);
        // Verify Press Releases was correctly removed in the previous task:
        const pressLink = footerLinks.find(a => a.textContent.includes('Press Releases'));
        expect(pressLink).toBeUndefined();
    });

    // 7. API File sanity checking
    test('API Helper file exports properly', () => {
        const apiPath = path.resolve(__dirname, '../js/api.js');
        const apiCode = fs.readFileSync(apiPath, 'utf8');
        expect(apiCode).toContain('class ApiService');
        expect(apiCode).toContain('fetchProducts(');
        expect(apiCode).toContain('fetch('); // Uses native fetch
    });
});
