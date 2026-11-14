import type { ReactNode } from 'react';
import { PRO_SOON, usePaymentsOpen } from '../lib/payments';
import { Link } from './Link';

/**
 * A link to the Pricing page. While the server is not taking payments it becomes a plain note,
 * so no upgrade prompt points at a checkout that cannot open.
 */
export function UpgradeLink({
  children,
  className = 'link',
}: {
  children: ReactNode;
  className?: string;
}) {
  const open = usePaymentsOpen();
  if (open === false) return <span className="meta">{PRO_SOON}</span>;
  return (
    <Link to="pricing" className={className}>
      {children}
    </Link>
  );
}
