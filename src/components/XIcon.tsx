import type { SVGProps } from 'react';

/**
 * The X logo, inlined.
 *
 * lucide-react ships `Twitter`, but that is the retired bird — pointing it at
 * an x.com URL reads as a dead brand. lucide has no X glyph (brand icons were
 * dropped upstream), so the mark lives here rather than pulling in a second
 * icon package for one path.
 *
 * `currentColor` and no hardcoded size, so it inherits `text-*` and `size-*`
 * from the call site exactly like the lucide icons it sits beside.
 */
export function XIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
      {...rest}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
