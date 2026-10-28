"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Button, ErrorNote, Spinner } from "./ui";

export function OperatorDialog({ onClose, onUnlocked, configured }: { onClose: () => void; onUnlocked: () => void; configured: boolean }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/session", { method: "POST", body: { token } });
      onUnlocked();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-labelledby="op-title">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-2xl">
        <h2 id="op-title" className="text-base font-semibold">Operator access</h2>
        <p className="mt-1 text-sm text-ink-2">
          Real provisioning is limited to the project owner so anonymous visitors cannot spend the workspace&apos;s plan limits.
          {configured ? " Enter LAUNCHPAD_OPERATOR_TOKEN to unlock it for 8 hours." : " No operator token is configured on this server."}
        </p>
        {configured && (
          <>
            <label htmlFor="op-token" className="mt-4 block text-xs font-medium text-ink-2">Operator token</label>
            <input id="op-token" ref={ref} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent/60" />
          </>
        )}
        {error && <div className="mt-3"><ErrorNote code={error.code} message={error.message} /></div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {configured && <Button type="submit" variant="primary" disabled={busy || token.length < 16}>{busy ? <Spinner /> : null} Unlock</Button>}
        </div>
      </form>
    </div>
  );
}
