"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Props = {
  callbackURL: string;
  /** Lock the email (used on invite links, where it must match the invite). */
  fixedEmail?: string;
  cta?: string;
};

export function MagicLinkForm({ callbackURL, fixedEmail, cta = "Email me a sign-in link" }: Props) {
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    const { error } = await authClient.signIn.magicLink({ email: email.trim(), callbackURL });
    if (error) {
      setError(error.message ?? "That link couldn't be sent. Check the address and try again.");
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div role="status" className="rounded border border-frost bg-salt p-4">
        <p className="font-semibold">Check {email.trim()}</p>
        <p className="hint mt-1">
          The link works once and expires in 15 minutes. Open it on this device to stay signed in here.
        </p>
        <button type="button" className="mt-3 text-sm font-semibold underline" onClick={() => setStatus("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="input"
          value={email}
          readOnly={!!fixedEmail}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "email-error" : undefined}
          aria-invalid={!!error}
        />
        {error && <p id="email-error" className="mt-1.5 text-sm text-brake">{error}</p>}
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : cta}
      </button>
    </form>
  );
}
