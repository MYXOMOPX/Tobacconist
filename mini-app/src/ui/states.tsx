import type { ReactNode } from 'react';
import { cx } from './primitives';

/**
 * Every list in the app has four states, not one: loading, empty, error, data
 * (spec §11). These are the first three, so a screen can never quietly render
 * a blank page while it waits.
 */

export function Skeleton({ variant = 'card' }: { variant?: 'card' | 'line' }) {
  return <div className={cx('tb-skeleton', `tb-skeleton--${variant}`)} aria-hidden="true" />;
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="tb-stack" role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="tb-state">
      <h2 className="tb-state__title">{title}</h2>
      {text ? <p className="tb-state__text">{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Не получилось загрузить',
  text,
  onRetry,
}: {
  title?: string;
  text?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="tb-state" role="alert">
      <h2 className="tb-state__title">{title}</h2>
      {text ? <p className="tb-state__text">{text}</p> : null}
      {onRetry ? (
        <button type="button" className="tb-btn tb-btn--secondary" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}
