'use client';

import React from 'react';
import { Info, X } from 'lucide-react';

/**
 * Small styled building blocks for the overview, copied from the Board's
 * visual vocabulary (slate neutrals, indigo accent, colored panel bands) so
 * the two jobs pages read as one product.
 */

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon,
  title,
  subtitle,
  right,
  as: Heading = 'h2',
  className = '',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <Heading className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </Heading>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export type Tone = 'amber' | 'sky' | 'red' | 'neutral' | 'indigo';
const BAND: Record<Tone, string> = {
  amber: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/10',
  sky: 'border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/10',
  red: 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40',
  neutral: 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30',
  indigo: 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/60 dark:bg-indigo-950/20',
};
export function Band({
  tone,
  children,
  className = '',
  ...rest
}: { tone: Tone; children: React.ReactNode; className?: string } & Omit<
  React.HTMLAttributes<HTMLElement>,
  'children' | 'className'
>) {
  return (
    <section className={`border-b ${BAND[tone]} ${className}`} {...rest}>
      {children}
    </section>
  );
}

export type PillTone =
  | 'neutral'
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'violet'
  | 'teal'
  | 'red'
  | 'blue'
  | 'sky';
export const PILL: Record<PillTone, string> = {
  neutral:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  indigo:
    'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800',
  emerald:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800',
  amber:
    'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800',
  violet:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800',
  teal: 'bg-teal-50 text-teal-800 ring-teal-300 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-700',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-800',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800',
};
export function Pill({
  tone = 'neutral',
  children,
  className = '',
  title,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${PILL[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-slate-300 shadow-sm dark:border-slate-700"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`${size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm'} font-medium transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-200 dark:focus:ring-indigo-900/60 ${
            value === option.value
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200'
              : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const CONTROL =
  'min-h-9 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900/60';
export function Field({
  label,
  children,
  className = '',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Select(props: React.ComponentPropsWithRef<'select'>) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ''}`} />;
}
export function TextInput(props: React.ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ''}`} />;
}

const BUTTON = {
  primary:
    'inline-flex min-h-9 items-center justify-center gap-1 rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50',
  secondary:
    'inline-flex min-h-9 items-center justify-center gap-1 rounded border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
  ghost:
    'inline-flex min-h-8 items-center justify-center gap-1 rounded px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40',
  amber:
    'inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40',
  sky: 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-sky-300 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:text-sky-200 dark:hover:bg-sky-900/40',
  icon: 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
};
export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return <button type={type} className={`${BUTTON[variant]} ${className}`} {...rest} />;
}

/** Text-styled button for opening an application from a list. */
export function LinkButton({
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`text-left font-medium text-indigo-600 hover:underline dark:text-indigo-300 ${className}`}
      {...rest}
    />
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

/** An "i" button that reveals a short explanation; keeps caveats out of the headings. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-6 z-30 w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white p-3 text-xs font-normal normal-case tracking-normal text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <span className="float-right -mr-1 -mt-1">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
          {children}
        </span>
      )}
    </span>
  );
}

export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 py-1 pl-3 pr-1 text-xs font-medium text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
