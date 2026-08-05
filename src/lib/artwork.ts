/**
 * Local re-implementation of `ArcRegistrarU.renderSVG`.
 *
 * Used only as a fallback when `tokenURI` can't be read (RPC hiccup, or a
 * marketplace listing whose label hasn't been recorded on-chain). It must look
 * identical to the minted artwork, so this is a literal transcription of the
 * Solidity — including `_fs`, which the previous local copy omitted: it
 * hardcoded font-size 84 for every name, so short names rendered visibly
 * smaller than their real NFT and long ones overflowed the card.
 */

/** `ArcRegistrarU._fs` — font size from total glyph count (label + ".arc"). */
function fontSizeFor(totalChars: number): number {
  if (totalChars <= 9) return 188;
  if (totalChars <= 12) return 150;
  if (totalChars <= 16) return 116;
  if (totalChars <= 22) return 84;
  return 62;
}

/** Escapes the label for safe interpolation into SVG text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderNameSvg(label: string): string {
  const fontSize = fontSizeFor(label.length + 5);
  const safe = escapeXml(label);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000" font-family="'Helvetica Neue',Arial,sans-serif">`
    + `<defs><radialGradient id="g" cx="50%" cy="-8%" r="75%"><stop offset="0%" stop-color="#7DFF66" stop-opacity=".22"/><stop offset="55%" stop-color="#7DFF66" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="g2" cx="85%" cy="88%" r="42%"><stop offset="0%" stop-color="#7DFF66" stop-opacity=".10"/><stop offset="70%" stop-color="#7DFF66" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="1000" height="1000" fill="#070B08"/><rect width="1000" height="1000" fill="url(#g)"/><rect width="1000" height="1000" fill="url(#g2)"/>`
    + `<svg x="64" y="58" width="72" height="72" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7DFF66"/><path d="M18 46V22l14-5 14 5v24" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/><path d="M27 46V35h10v11" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/></svg>`
    + `<text x="152" y="107" font-weight="800" font-size="40" fill="#EAF6EC">arc<tspan fill="#7DFF66">.</tspan></text>`
    + `<text x="500" y="500" text-anchor="middle" dominant-baseline="central" font-weight="800" font-size="${fontSize}" letter-spacing="-3" fill="#EAF6EC">${safe}<tspan fill="#7DFF66">.arc</tspan></text>`
    + `<text x="500" y="928" text-anchor="middle" font-weight="600" font-size="26" letter-spacing="8" fill="#7E9384">ARC BLOCKCHAIN</text>`
    + `</svg>`;
}

export function nameSvgDataUri(label: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderNameSvg(label))}`;
}

/**
 * Pulls the `image` out of the contract's base64 `tokenURI` payload.
 *
 * Returns null rather than throwing so callers can fall back to the local
 * render without a try/catch at every call site.
 */
export function imageFromTokenUri(tokenUri: string | undefined | null): string | null {
  if (!tokenUri) return null;
  const prefix = 'data:application/json;base64,';
  if (!tokenUri.startsWith(prefix)) return null;

  try {
    const json = JSON.parse(atob(tokenUri.slice(prefix.length)));
    return typeof json.image === 'string' ? json.image : null;
  } catch {
    return null;
  }
}
