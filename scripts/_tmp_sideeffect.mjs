// Instrumented purity audit: trap every side-effecting global and count
// accesses made DURING each wallet factory call.
const log = [];
function mkTrap(name) {
  return new Proxy(function(){}, {
    get(t,p){ if(typeof p==='string') log.push(`${name}.${p} [get]`); return mkTrap(`${name}.${String(p)}`); },
    apply(){ log.push(`${name}() [CALL]`); return mkTrap(`${name}()`); },
    construct(){ log.push(`new ${name}() [CONSTRUCT]`); return mkTrap(`new ${name}`); },
    set(t,p,v){ log.push(`${name}.${String(p)} [SET]`); return true; },
    has(){ return true; },
  });
}
const ETH_HITS = [];
const ethTarget = { isMetaMask: true, _events:{}, _state:{}, isRabby: false };
const ethereum = new Proxy(ethTarget, {
  get(t,p){ ETH_HITS.push(String(p)); return t[p]; },
});
const store = new Map();
const win = {
  navigator: { userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', platform:'Linux', maxTouchPoints:0 },
  location: { origin:'https://arcnaming.xyz', href:'https://arcnaming.xyz/' },
  ethereum,
  localStorage: { getItem:(k)=>{log.push(`localStorage.getItem(${k})`);return store.get(k)??null;},
                  setItem:(k,v)=>{log.push(`localStorage.setItem(${k}) [WRITE]`);store.set(k,v);},
                  removeItem:(k)=>{log.push(`localStorage.removeItem(${k}) [WRITE]`);store.delete(k);} },
  sessionStorage: { getItem:()=>{log.push('sessionStorage.getItem');return null;}, setItem:()=>log.push('sessionStorage.setItem [WRITE]') },
  addEventListener:(e)=>log.push(`window.addEventListener(${e}) [LISTENER]`),
  removeEventListener:()=>{},
  dispatchEvent:(e)=>{log.push(`window.dispatchEvent(${e?.type}) [EVENT]`); return true;},
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  fetch: mkTrap('window.fetch'),
  WebSocket: mkTrap('WebSocket'),
  XMLHttpRequest: mkTrap('XMLHttpRequest'),
  indexedDB: mkTrap('indexedDB'),
  crypto: globalThis.crypto,
};
win.parent = win; win.top = win; win.self = win; win.window = win;
globalThis.window = win;
for (const k of ['navigator','location','localStorage','sessionStorage','indexedDB']) {
  Object.defineProperty(globalThis, k, { value: win[k], configurable:true, writable:true });
}
globalThis.document = { createElement:(t)=>{log.push(`document.createElement(${t}) [DOM]`);return {style:{},setAttribute(){},appendChild(){},remove(){}};},
  head:{appendChild:()=>log.push('head.appendChild [DOM]')}, body:{appendChild:()=>log.push('body.appendChild [DOM]')},
  documentElement:{style:{}}, addEventListener:(e)=>log.push(`document.addEventListener(${e}) [LISTENER]`),
  removeEventListener(){}, querySelector:()=>null, getElementsByTagName:()=>[] };
const realFetch = globalThis.fetch;
globalThis.fetch = mkTrap('fetch');
globalThis.WebSocket = mkTrap('WebSocket');
globalThis.XMLHttpRequest = mkTrap('XMLHttpRequest');

const W = await import('@rainbow-me/rainbowkit/wallets');
const APP_NAME='Arc Names';
const META={name:APP_NAME,description:APP_NAME,url:'',icons:[]};
const browserWallet = () => ({ ...W.injectedWallet(), hidden: () => typeof window==='undefined' || window.ethereum===undefined });
const ALL = [['safeWallet',W.safeWallet],['rainbowWallet',W.rainbowWallet],['base',W.base],
 ['metaMaskWallet',W.metaMaskWallet],['walletConnectWallet',W.walletConnectWallet],
 ['coinbaseWallet',W.coinbaseWallet],['rabbyWallet',W.rabbyWallet],['okxWallet',W.okxWallet],
 ['bitgetWallet',W.bitgetWallet],['trustWallet',W.trustWallet],['browserWallet',browserWallet]];

console.log('AUDIT: side effects during factory call with projectId="" (the probe)\n');
for (const [name, f] of ALL) {
  log.length = 0; ETH_HITS.length = 0;
  let outcome;
  try {
    const w = f({ projectId:'', appName:APP_NAME, appIcon:'https://arcnaming.xyz/logo.png',
      options:{metadata:META}, walletConnectParameters:{metadata:META} });
    outcome = `built (iconUrl=${typeof w.iconUrl})`;
  } catch(e) { outcome = 'THREW: '+e.message.slice(0,40); }
  const bad = log.filter(l=>/\[(WRITE|LISTENER|CALL|CONSTRUCT|DOM|EVENT|SET)\]/.test(l));
  console.log(`${name.padEnd(21)} ${outcome}`);
  console.log(`${''.padEnd(21)}   window.ethereum reads: ${ETH_HITS.length?ETH_HITS.join(','):'(none)'}`);
  console.log(`${''.padEnd(21)}   SIDE EFFECTS: ${bad.length? '!!! '+bad.join(' | ') : 'NONE'}`);
}
