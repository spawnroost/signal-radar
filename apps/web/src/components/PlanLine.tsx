import type { ReactNode } from 'react';
import type { PlanBadge } from '../lib/plan';

/** The plan name as a small pill: filled for Pro, quiet for Free. One look in the menu, Settings and Pricing. */
export function PlanPill({ name }: { name: PlanBadge['name'] }) {
  return (
    <span className="plan-badge" data-pro={name === 'Pro' || undefined}>
      {name}
    </span>
  );
}

/** A non-interactive status line: the pill, then what it means. Never a button, never a box. */
export function PlanLine({
  name,
  children,
  role,
}: {
  name: PlanBadge['name'];
  children: ReactNode;
  role?: 'status';
}) {
  return (
    <p className="plan-line" role={role}>
      <PlanPill name={name} />
      <span className="plan-line-text">{children}</span>
    </p>
  );
}
