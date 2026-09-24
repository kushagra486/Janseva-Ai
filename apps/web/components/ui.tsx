import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-saffron text-saffron-ink hover:brightness-110",
  secondary: "bg-surface-2 text-ink border border-line hover:border-saffron/60",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  success: "bg-green text-white hover:brightness-110",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-2xl border border-line bg-surface/90 p-4 shadow-lg shadow-black/20 sm:p-5", className)}
      {...props}
    />
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "saffron" | "green" | "danger" | "warn"; children: ReactNode }) {
  const tones = {
    muted: "bg-surface-2 text-muted border-line",
    saffron: "bg-saffron/15 text-saffron border-saffron/40",
    green: "bg-green/15 text-green border-green/40",
    danger: "bg-danger/15 text-danger border-danger/40",
    warn: "bg-warn/15 text-warn border-warn/40",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
    </header>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-saffron border-t-transparent" />
      {label}
    </span>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-danger">
      {children}
    </p>
  );
}

export const inputClass =
  "w-full min-h-12 rounded-xl border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-muted/70 focus:border-saffron focus:outline-none";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
      {children}
    </label>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "bg-green" : value >= 0.6 ? "bg-warn" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${pct}%`}>
      <span className="h-2 w-20 overflow-hidden rounded-full bg-surface-2">
        <span className={clsx("block h-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted">{pct}%</span>
    </span>
  );
}
