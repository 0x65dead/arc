import { useQuery } from '@tanstack/react-query';
import { nameSvgDataUri } from '../lib/artwork';
import { cx } from './ui';

/**
 * The card art for a name.
 *
 * Rendered locally from `renderNameSvg`, which is a transcription of the
 * registrar's own `renderSVG`. For a name that isn't registered yet there is no
 * `tokenURI` to read, so this is the only way to show what the token will look
 * like — and for one that is, it matches.
 */
export function NameArtwork({
  label,
  className,
  src,
}: {
  label: string;
  className?: string;
  /** Overrides the local render, e.g. with the on-chain `tokenURI` image. */
  src?: string | null;
}) {
  const { data } = useQuery({
    queryKey: ['artwork-local', label],
    enabled: !src && Boolean(label),
    staleTime: Infinity,
    queryFn: async () => nameSvgDataUri(label),
  });

  const source = src ?? data;

  return (
    <div className={cx('overflow-hidden border border-border bg-surface-raised', className)}>
      {source ? (
        <img src={source} alt={`${label}.arc`} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="size-full" aria-hidden />
      )}
    </div>
  );
}
