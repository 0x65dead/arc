/*
 * Verifies the wallet list the app will actually build, by calling the real
 * RainbowKit wallet factories from node_modules under simulated environments.
 *
 * This checks the two things source-reading cannot: which factories throw
 * without a WalletConnect project ID (and so are dropped by `relayFreeWallets`),
 * and what each wallet reports for `installed` / mobile deep links in each
 * environment. Run with: node scripts/verify-wallets.mjs
 */
const W = await import('@rainbow-me/rainbowkit/wallets');

const APP_NAME = 'Arc Names';
const META = { name: APP_NAME, description: APP_NAME, url: '', icons: [] };

const POPULAR = [
  ['safeWallet', W.safeWallet],
  ['rainbowWallet', W.rainbowWallet],
  ['base', W.base],
  ['metaMaskWallet', W.metaMaskWallet],
  ['walletConnectWallet', W.walletConnectWallet],
];
/** Mirrors `browserWallet` in src/config/wagmi.ts. */
const browserWallet = () => ({
  ...W.injectedWallet(),
  hidden: () => typeof window === 'undefined' || window.ethereum === undefined,
});

const MORE = [
  ['coinbaseWallet', W.coinbaseWallet],
  ['rabbyWallet', W.rabbyWallet],
  ['okxWallet', W.okxWallet],
  ['bitgetWallet', W.bitgetWallet],
  ['trustWallet', W.trustWallet],
  ['browserWallet', browserWallet],
];

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Mirrors `relayFreeWallets` in src/config/wagmi.ts. */
function probe(createWallet, projectId) {
  try {
    return {
      ok: true,
      wallet: createWallet({
        projectId,
        appName: APP_NAME,
        appIcon: undefined,
        options: { metadata: META },
        walletConnectParameters: { metadata: META },
      }),
    };
  } catch (error) {
    return { ok: false, error: error.message.split('\n')[0] };
  }
}

function setEnv({ ua, ethereum, inIframe = false }) {
  const win = {
    navigator: { userAgent: ua, platform: 'Linux', maxTouchPoints: ua === ANDROID_UA ? 5 : 0 },
    location: { origin: 'https://arcnaming.xyz' },
    ethereum,
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
  win.parent = inIframe ? {} : win;
  globalThis.window = win;
  // Node 22 defines `navigator` as a getter-only global, so it has to be
  // redefined rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'location', {
    value: win.location,
    configurable: true,
    writable: true,
  });
}

function report(title, projectId, { mobile = false } = {}) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
  for (const [groupName, group] of [
    ['Popular', POPULAR],
    ['More', MORE],
  ]) {
    console.log(`\n  ── ${groupName} ──`);
    for (const [name, factory] of group) {
      const result = probe(factory, projectId);
      if (!result.ok) {
        console.log(`  ${'✗'} ${name.padEnd(21)} DROPPED — ${result.error.slice(0, 46)}`);
        continue;
      }
      const w = result.wallet;
      // `connectorsForWallets` skips any wallet whose `hidden()` returns true
      // before it ever reaches the modal (dist/index.js ~7021).
      if (typeof w.hidden === 'function' && w.hidden()) {
        console.log(`  ${'·'} ${name.padEnd(21)} "${w.name}" HIDDEN (no window.ethereum)`);
        continue;
      }
      // RainbowKit: `ready = installed ?? true`. DesktopOptions keeps a wallet
      // when `ready || extensionDownloadUrl` (an unready wallet with a download
      // link is listed, and selecting it shows install instructions);
      // MobileOptions keeps it only when `ready`.
      const ready = w.installed ?? true;
      // Chrome is assumed for the desktop cases below.
      const extensionDownload = w.downloadUrls?.chrome ?? w.downloadUrls?.browserExtension;
      const listed = mobile ? ready : ready || Boolean(extensionDownload);
      const state = !listed ? 'NOT LISTED' : ready ? 'listed' : 'listed(install)';
      const flags = [
        state,
        w.installed === true ? 'installed' : '',
        w.mobile?.getUri ? 'deeplink' : '',
        w.qrCode?.getUri ? 'qr' : '',
        w.rdns ? `rdns=${w.rdns}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.log(`  ${listed ? '✓' : '·'} ${name.padEnd(21)} "${w.name}" ${flags}`);
    }
  }
}

const REAL_ID = 'a'.repeat(32); // shape-valid; never contacts the relay here
const METAMASK = { isMetaMask: true, _events: {}, _state: {} };

setEnv({ ua: DESKTOP_UA, ethereum: undefined });
report('DESKTOP · no extension · projectId SET', REAL_ID);

setEnv({ ua: DESKTOP_UA, ethereum: undefined });
report('DESKTOP · no extension · projectId MISSING', '');

setEnv({ ua: DESKTOP_UA, ethereum: METAMASK });
report('DESKTOP · MetaMask extension · projectId MISSING', '');

setEnv({ ua: ANDROID_UA, ethereum: undefined });
report('ANDROID CHROME · no in-app provider · projectId SET', REAL_ID, { mobile: true });

setEnv({ ua: ANDROID_UA, ethereum: undefined });
report('ANDROID CHROME · no in-app provider · projectId MISSING', '', { mobile: true });

setEnv({ ua: ANDROID_UA, ethereum: { isTrust: true } });
report('ANDROID · inside Trust in-app browser · projectId SET', REAL_ID, { mobile: true });

setEnv({ ua: DESKTOP_UA, ethereum: undefined, inIframe: true });
report('DESKTOP · inside a Safe iframe · projectId SET', REAL_ID);
