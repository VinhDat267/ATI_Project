import presentation from '../assets/cockpit-services.json';
const assets = presentation.services as Record<string, { logoPath: string; color: string }>;
/** Brand marks are presentation assets; service selection remains catalog-driven. */
export function ServiceLogo({ service, className = 'shrink-0' }: { service: string; className?: string }) {
  const asset=assets[service];
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" className={className} fill={asset?.color ?? 'currentColor'} fillRule="evenodd"><path d={asset?.logoPath ?? 'M4 4h16v16H4zm3 3v10h10V7z'} /></svg>;
}
