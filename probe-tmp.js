const fs = require('fs'); const path = require('path'); const util = require('util');
global.TextEncoder = util.TextEncoder; global.TextDecoder = util.TextDecoder;
const { JSDOM } = require('jsdom');
const ROOT = process.cwd();

(async () => {
  for (const url of ['https://glomek.com/index.html?product=P42', 'https://glomek.com/?product=P42']) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    let fetchedById = false;
    win.fetch = async (u) => {
      u = String(u);
      if (/\/products\/P42/.test(u)) {
        fetchedById = true;
        return { ok: true, json: async () => ({ success: true, data: { _id: 'P42', name: 'Shared Product', price: 10, images: [{ url: 'a.png' }] } }) };
      }
      if (u.includes('/products?')) return { ok: true, json: async () => ({ success: true, data: [{ _id: 'X1', name: 'Other', price: 5 }], total: 1 }) };
      return { ok: true, json: async () => ({ success: true, data: [] }) };
    };
    win.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
    win.scrollTo = () => {}; win.navigator.vibrate = () => true;
    win.Element.prototype.scrollIntoView = () => {};
    win.eval(['js/api.js','js/app.js','js/mobile-app.js','js/modern-home.js']
      .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));

    const modal = win.document.getElementById('productDetailModal');
    console.log('\nURL:', url);
    console.log('  final address    :', win.location.pathname + win.location.search);
    console.log('  fetched by id    :', fetchedById);
    console.log('  detail modal open:', modal ? !modal.hidden : 'no modal el');
  }
})();
