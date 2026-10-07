import presentation from '../assets/cockpit-services.json';
const assets = presentation.services as Record<string, { logoPath?: string; logoParts?: { d: string; fill: string }[]; color?: string }>;
/** Brand marks are presentation assets; service selection remains catalog-driven. `mono` draws a multi-colour mark in currentColor. */
export function ServiceLogo({ service, className = 'shrink-0', mono = false }: { service: string; className?: string; mono?: boolean }) {
  const asset=assets[service];
  if (asset?.logoParts) return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" className={className} fill="none">{asset.logoParts.map(part => <path key={part.fill} d={part.d} fill={mono ? 'currentColor' : part.fill} />)}</svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" className={className} fill={asset?.color ?? 'currentColor'} fillRule="evenodd"><path d={asset?.logoPath ?? 'M4 4h16v16H4zm3 3v10h10V7z'} /></svg>;
}
