import type { ReactNode } from "react";
import type { ResourceType, StatusTone } from "@/lib/schemas";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const toneClass: Record<StatusTone, string> = {
  ok: "bg-ok",
  pending: "bg-warn pulse-dot",
  error: "bg-err",
  neutral: "bg-ink-3",
};

export function StatusPill({ status, tone }: { status: string; tone: StatusTone }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs text-ink-2">
      <span className={cx("h-1.5 w-1.5 rounded-full", toneClass[tone])} aria-hidden />
      {status}
    </span>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "err" | "ok"; title?: string }) {
  const map = {
    neutral: "border-line text-ink-2 bg-panel-2",
    accent: "border-accent/40 text-accent bg-accent/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    err: "border-err/40 text-err bg-err/10",
    ok: "border-ok/40 text-ok bg-ok/10",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider", map[tone])}>
      {children}
    </span>
  );
}

export function Panel({ title, subtitle, actions, children, className, id }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-panel", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Button({
  children, onClick, variant = "secondary", disabled, type = "button", className, title,
}: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; type?: "button" | "submit"; className?: string; title?: string }) {
  const v = {
    primary: "bg-accent text-accent-ink hover:brightness-110 border-transparent font-medium",
    secondary: "bg-panel-2 text-ink border-line hover:border-ink-3",
    ghost: "bg-transparent text-ink-2 border-transparent hover:text-ink hover:bg-panel-2",
    danger: "bg-err/15 text-err border-err/40 hover:bg-err/25",
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50", v, className)}>
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

const icons: Record<ResourceType, ReactNode> = {
  database: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  bucket: <path d="M3 7h18l-2 13H5L3 7Zm2-3h14l2 3H3l2-3Zm5 8h4" />,
  vectors: <path d="M4 20 10 8l4 6 6-10M4 20h16M10 8a1.5 1.5 0 1 0 0-.01M14 14a1.5 1.5 0 1 0 0-.01M20 4a1.5 1.5 0 1 0 0-.01" />,
  memory: <path d="M7 4h10v16H7zM4 8h3M4 12h3M4 16h3M17 8h3M17 12h3M17 16h3M10 8h4v8h-4z" />,
  function: <path d="M14 4h-2a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H5M7 11h7M15 13l3 3-3 3M19 13l-3 3" />,
};

export function TypeIcon({ type, className }: { type: ResourceType; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={cx("h-4 w-4", className)} aria-hidden>
      {icons[type]}
    </svg>
  );
}

export function ErrorNote({ code, message, onRetry }: { code?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-err/30 bg-err/5 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        {code && <div className="font-mono text-[11px] text-err">{code}</div>}
        <div className="text-ink-2">{message}</div>
      </div>
      {onRetry && <Button variant="ghost" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
