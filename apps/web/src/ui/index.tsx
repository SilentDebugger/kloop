import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { initials } from "../lib/format";

/* ------------------------------------------------------------------ */
/* Logo — the ring mark                                                */
/* ------------------------------------------------------------------ */
export function Logo({ size = 28, stroke = 4.5 }: { size?: number; stroke?: number }) {
  const r = (32 - stroke) / 2 - 3;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="kloop">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--color-primary)" strokeWidth={stroke} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-dark active:bg-primary-dark disabled:opacity-50 shadow-sm",
  secondary: "glass text-ink hover:bg-white/65 active:bg-white/65 disabled:opacity-50",
  ghost: "glass text-primary hover:bg-mint/70 active:bg-mint/70 disabled:opacity-40",
  danger: "glass text-danger hover:bg-danger-soft/80 active:bg-danger-soft/80 disabled:opacity-50",
  outline: "glass text-ink hover:bg-white/65 active:bg-white/65 disabled:opacity-50",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean }
>(function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }, ref) {
  const sizes = { sm: "px-3.5 py-1.5 text-[13px]", md: "px-5 py-2.5 text-[15px]", lg: "w-full px-5 py-3.5 text-[15px]" };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors cursor-pointer disabled:cursor-default ${buttonStyles[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={14} light={variant === "primary"} />}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */
export function Card({
  children,
  className = "",
  onClick,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: "div" | "button" | "section";
}) {
  const interactive = onClick ? "text-left w-full cursor-pointer transition-shadow hover:shadow-float" : "";
  return (
    <Tag onClick={onClick} className={`rounded-card bg-card shadow-card ${interactive} ${className}`}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Chips & badges                                                      */
/* ------------------------------------------------------------------ */
export function Chip({
  children,
  onClick,
  active,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        active ? "glass-dark text-white" : "glass text-ink"
      } ${onClick && !active ? "cursor-pointer hover:bg-white/65" : ""} ${onClick && active ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function StatusBadge({ status }: { status: "open" | "handled" | "solved" | string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-chip text-ink-secondary" },
    handled: { label: "Being handled", cls: "bg-mint text-primary" },
    solved: { label: "Solved", cls: "bg-mint text-primary" },
  };
  const m = map[status] ?? { label: status, cls: "bg-chip text-ink-secondary" };
  return <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[12px] font-semibold ${m.cls}`}>{m.label}</span>;
}

export function TagChip({ tag }: { tag: string }) {
  return <span className="inline-flex items-center rounded-full bg-chip px-2.5 py-1 text-[12px] font-medium text-ink-secondary">{tag}</span>;
}

export function KindBadge({ kind }: { kind: "draft" | "update" | "merge" | "stale" | string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "NEW DRAFT", cls: "bg-mint text-primary" },
    update: { label: "UPDATE", cls: "bg-mint text-primary" },
    merge: { label: "MERGE", cls: "bg-chip text-ink-secondary" },
    stale: { label: "STALE DOC", cls: "bg-amber-soft text-amber" },
  };
  const m = map[kind] ?? { label: kind.toUpperCase(), cls: "bg-chip text-ink-secondary" };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${m.cls}`}>{m.label}</span>;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-inner border border-line bg-card px-4 py-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary ${className}`}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={`w-full resize-none rounded-inner border border-line bg-card px-4 py-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary ${className}`}
      {...rest}
    />
  );
});

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`section-label ${className}`}>{children}</div>;
}

export function Avatar({ name, size = 36, tint = false }: { name: string | null | undefined; size?: number; tint?: boolean }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        tint ? "bg-mint-strong text-primary" : "bg-chip text-ink-secondary"
      }`}
    >
      {initials(name)}
    </div>
  );
}

export function Spinner({ size = 18, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="loading">
      <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" className={light ? "stroke-white/30" : "stroke-line"} />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" strokeWidth="3" strokeLinecap="round" className={light ? "stroke-white" : "stroke-primary"} />
    </svg>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="fade-up flex flex-col items-center gap-2 py-16 text-center">
      {icon ?? <Logo size={36} stroke={4} />}
      <div className="mt-2 font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-xs text-[13px] text-ink-secondary">{hint}</div>}
    </div>
  );
}

/** Consistent query-failure state: message + retry, matching EmptyState's layout. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="fade-up flex flex-col items-center gap-2 py-16 text-center">
      <Logo size={36} stroke={4} />
      <div className="mt-2 font-semibold text-ink">Couldn't load this</div>
      <div className="max-w-xs text-[13px] text-ink-secondary">{message ?? "Check your connection and try again."}</div>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h1 className={`text-[28px] font-bold tracking-tight text-ink ${className}`}>{children}</h1>;
}

/** segmented pill tabs — "Drafts · 4 | Updates · 2 | Merges · 1" */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="glass flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer ${
            o.value === value ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** count badge (reviews tab) */
export function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** iOS-style toggle used in settings */
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

/** modal sheet: bottom sheet on mobile, centered dialog on desktop */
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="sheet-up relative max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-5 pb-8 shadow-float sm:max-w-lg sm:rounded-card sm:pb-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        {title && <h2 className="mb-3 text-xl font-bold text-ink">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/** inline error banner */
export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-inner bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger">{children}</div>;
}
