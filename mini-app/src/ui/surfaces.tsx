import { useEffect, type ReactNode } from 'react';
import { cx, Money, Qty } from './primitives';
import { ORDER_STATUS_LABEL, statusBadgeModifier, type OrderStatus } from './status';

/* ---------- Card ---------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('tb-card', className)}>{children}</section>;
}

export function CardHead({ title, trailing }: { title: ReactNode; trailing?: ReactNode }) {
  return (
    <header className="tb-card__head">
      <h2 className="tb-card__title">{title}</h2>
      {trailing}
    </header>
  );
}

/* ---------- Ledger row ---------- */
/* The signature element: a receipt line. Name left, figures right, dotted rail
   between them — the same shape as the monospace snapshot sent to the vendor,
   so a list of positions reads the way the order itself is written down. */

export function LedgerRow({
  name,
  meta,
  quantity,
  amount,
  note,
  unavailable = false,
}: {
  name: string;
  meta?: string;
  quantity?: number;
  amount?: number;
  note?: string;
  unavailable?: boolean;
}) {
  return (
    <div className={cx('tb-ledger', unavailable && 'tb-ledger--unavailable')}>
      <span className="tb-ledger__label">
        <span className="tb-ledger__name">{name}</span>
        {meta ? <span className="tb-ledger__meta">{meta}</span> : null}
      </span>
      <span className="tb-ledger__rail" aria-hidden="true" />
      <span className="tb-ledger__value">
        {note ? <span className="tb-ledger__note">{note}</span> : null}
        {quantity === undefined ? null : <Qty value={quantity} />}
        {amount === undefined ? null : <Money value={amount} />}
      </span>
    </div>
  );
}

/* ---------- Status badge ---------- */

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cx('tb-badge', `tb-badge--${statusBadgeModifier(status)}`)}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ordering' | 'awaiting' | 'done' | 'rejected';
}) {
  return <span className={cx('tb-badge', `tb-badge--${tone}`)}>{children}</span>;
}

/* ---------- Banner ---------- */

export function Banner({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'danger';
}) {
  return (
    <p
      className={cx('tb-banner', tone !== 'info' && `tb-banner--${tone}`)}
      // A failure interrupts what the person was doing; a notice does not.
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}

/* ---------- Selectable row ---------- */

export function Row({
  label,
  note,
  trailing,
  onClick,
  disabled = false,
}: {
  label: ReactNode;
  note?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="tb-row" onClick={onClick} disabled={disabled}>
      <span className="tb-row__label">
        <span>{label}</span>
        {note ? <span className="tb-row__note">{note}</span> : null}
      </span>
      {trailing}
    </button>
  );
}

/* ---------- Progress ---------- */

export function Progress({
  label,
  value,
  max,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  trailing?: ReactNode;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="tb-progress">
      <div className="tb-progress__head">
        <span>{label}</span>
        {trailing}
      </div>
      <div
        className="tb-progress__track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="tb-progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ---------- Snapshot for the vendor ---------- */

export function Snapshot({
  text,
  onCopy,
  onExport,
}: {
  text: string;
  onCopy: () => void;
  onExport: () => void;
}) {
  return (
    <div className="tb-snapshot">
      <pre className="tb-snapshot__text">{text}</pre>
      <div className="tb-snapshot__actions">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--block" onClick={onCopy}>
          Скопировать текст
        </button>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--block" onClick={onExport}>
          Выгрузить файл
        </button>
      </div>
    </div>
  );
}

/* ---------- Sticky summary bar ---------- */

export function StickyBar({
  summary,
  action,
  inline = false,
}: {
  summary: ReactNode;
  /** Optional: a bar can be a running total with nothing to press yet. */
  action?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={cx('tb-sticky', inline && 'tb-sticky--inline')}>
      <div className="tb-sticky__summary">{summary}</div>
      {action}
    </div>
  );
}

/* ---------- Tab bar ---------- */

export function TabBar<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <nav className="tb-tabbar" aria-label="Разделы">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cx('tb-tabbar__item', item.id === active && 'tb-tabbar__item--active')}
          aria-current={item.id === active ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/* ---------- Bottom sheet ---------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="tb-sheet__scrim" onClick={onClose}>
      <div
        className="tb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="tb-sheet__handle" aria-hidden="true" />
        <h2 className="tb-sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
