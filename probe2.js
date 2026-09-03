const fs=require('fs'),path=require('path'),util=require('util');
global.TextEncoder=util.TextEncoder; global.TextDecoder=util.TextDecoder;
const {JSDOM}=require('jsdom'); const ROOT=process.cwd();
(async()=>{
  const html=fs.readFileSync('index.html','utf8');
  const dom=new JSDOM(html,{url:'https://glomek.com/index.html?product=P42',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window;
  const log=[];
  const op=win.history.pushState.bind(win.history), or=win.history.replaceState.bind(win.history);
  win.history.pushState=(s,t,u)=>{log.push('pushState -> '+u+'   (search was '+win.location.search+')');return op(s,t,u);};
  win.history.replaceState=(s,t,u)=>{log.push('replaceState -> '+u+'   (search was '+win.location.search+')');return or(s,t,u);};
  let byId=false;
  win.fetch=async(u)=>{u=String(u);
    if(/\/products\/P42/.test(u)){byId=true;log.push('FETCH product by id');return{ok:true,json:async()=>({success:true,data:{_id:'P42',name:'Shared',price:10,images:[{url:'a.png'}]}})};}
    if(u.includes('/products?'))return{ok:true,json:async()=>({success:true,data:[{_id:'X1',name:'Other',price:5}],total:1})};
    return{ok:true,json:async()=>({success:true,data:[]})};};
  win.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  win.scrollTo=()=>{};win.navigator.vibrate=()=>true;win.Element.prototype.scrollIntoView=()=>{};
  win.eval(['js/api.js','js/app.js','js/mobile-app.js','js/modern-home.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n;\n'));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded',{bubbles:true}));
  await new Promise(r=>setTimeout(r,1000));
  console.log('\n--- history timeline ---'); log.forEach(l=>console.log('  '+l));
  console.log('\nfetched by id:', byId, '| modal open:', !win.document.getElementById('productDetailModal').hidden);
})();
