import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatEur, formatKg, formatQty } from './format';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------- Numerals ---------- */
/* Money, weight and pack counts are always monospaced with tabular figures, so
   a column of them lines up on the decimal point without any layout work. */

type NumTone = 'default' | 'muted' | 'accent';

function numClass(tone: NumTone, large: boolean): string {
  return cx(
    'tb-num',
    large && 'tb-num--lg',
    tone === 'muted' && 'tb-num--muted',
    tone === 'accent' && 'tb-num--accent',
  );
}

export function Money({
  value,
  large = false,
  tone = 'default',
}: {
  value: number;
  large?: boolean;
  tone?: NumTone;
}) {
  return (
    <span>
      <span className={numClass(tone, large)}>{formatEur(value)}</span>
      <span className="tb-unit">€</span>
    </span>
  );
}

export function Weight({
  kg,
  large = false,
  tone = 'default',
}: {
  kg: number;
  large?: boolean;
  tone?: NumTone;
}) {
  return (
    <span>
      <span className={numClass(tone, large)}>{formatKg(kg)}</span>
      <span className="tb-unit">кг</span>
    </span>
  );
}

export function Qty({ value, tone = 'muted' }: { value: number; tone?: NumTone }) {
  return <span className={numClass(tone, false)}>{formatQty(value)}</span>;
}

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export function Button({
  variant = 'secondary',
  block = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean }) {
  return (
    <button
      type="button"
      className={cx('tb-btn', `tb-btn--${variant}`, block && 'tb-btn--block', className)}
      {...rest}
    />
  );
}

/* ---------- Stepper ---------- */

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  disabled = false,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span className="tb-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="tb-stepper__btn"
        aria-label={`Убрать одну пачку: ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="tb-stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="tb-stepper__btn"
        aria-label={`Добавить одну пачку: ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  );
}

/* ---------- Chip ---------- */

export function Chip({
  children,
  selected = false,
  unavailable = false,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  unavailable?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        'tb-chip',
        selected && 'tb-chip--selected',
        unavailable && 'tb-chip--unavailable',
      )}
      aria-pressed={selected}
      disabled={unavailable}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Fields ---------- */

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  numeric = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  numeric?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
}) {
  const id = useId();
  return (
    <span className="tb-field">
      <label className="tb-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cx('tb-input', numeric && 'tb-input--num')}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode ?? (numeric ? 'decimal' : 'text')}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: T | null;
  onChange: (next: T | null) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
}) {
  const id = useId();
  return (
    <span className="tb-field">
      <label className="tb-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="tb-input"
        value={value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const match = options.find((option) => String(option.value) === raw);
          onChange(match ? match.value : null);
        }}
      >
        <option value="">{placeholder ?? 'Не выбрано'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/* ---------- Toggle (payment mark) ---------- */

export function Toggle({
  label,
  pressed,
  onChange,
  trailing,
}: {
  label: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tb-toggle"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      <span className="tb-toggle__box" aria-hidden="true">
        ✓
      </span>
      <span className="tb-toggle__label">{label}</span>
      {trailing}
    </button>
  );
}
