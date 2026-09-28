"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Props = { invitationId: string; organizationId: string; defaultName: string; destination: string };

export function AcceptInvite({ invitationId, organizationId, defaultName, destination }: Props) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (name.trim() && name.trim() !== defaultName) await authClient.updateUser({ name: name.trim() });
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error) {
      setError(error.message ?? "The invite couldn't be accepted. Ask the office to resend it.");
      setBusy(false);
      return;
    }
    await authClient.organization.setActive({ organizationId });
    router.push(destination);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-brake">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? "Joining…" : "Join the crew"}</button>
    </form>
  );
}
