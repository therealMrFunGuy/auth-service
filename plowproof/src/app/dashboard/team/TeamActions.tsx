"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function InviteForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const address = email.trim().toLowerCase();
    const { error } = await authClient.organization.inviteMember({ email: address, role, organizationId });
    setBusy(false);
    if (error) {
      setMessage({ ok: false, text: error.message ?? "The invite couldn't be sent." });
      return;
    }
    setMessage({ ok: true, text: `Invite sent to ${address}.` });
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="invite-email" className="label">Email</label>
        <input id="invite-email" type="email" required autoComplete="off" className="input" placeholder="driver@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <fieldset>
        <legend className="label">They&apos;ll be</legend>
        <div className="flex gap-5">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="role" className="accent-asphalt" checked={role === "member"} onChange={() => setRole("member")} />
            A driver
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="role" className="accent-asphalt" checked={role === "admin"} onChange={() => setRole("admin")} />
            Office staff
          </label>
        </div>
        <p className="hint mt-1.5">
          {role === "member" ? "Drivers see the route and customer notes on their phone." : "Office staff can import customers and invite drivers."}
        </p>
      </fieldset>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-thaw" : "text-brake"}`}>{message.text}</p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send invite"}</button>
    </form>
  );
}

export function InviteActions(props: { organizationId: string; invitationId: string; email: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"resend" | "cancel" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function resend() {
    setBusy("resend");
    const { error } = await authClient.organization.inviteMember({
      email: props.email,
      role: props.role === "admin" ? "admin" : "member",
      organizationId: props.organizationId,
      resend: true,
    });
    setBusy(null);
    setNote(error ? error.message ?? "Couldn't resend." : "Sent again.");
    router.refresh();
  }

  async function cancel() {
    setBusy("cancel");
    await authClient.organization.cancelInvitation({ invitationId: props.invitationId });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {note && <span role="status" className="text-sm text-slush">{note}</span>}
      <button type="button" className="btn btn-quiet min-h-9 px-3 text-sm" disabled={!!busy} onClick={resend}>
        {busy === "resend" ? "Sending…" : "Resend"}
      </button>
      <button type="button" className="btn btn-danger" disabled={!!busy} onClick={cancel}>Cancel invite</button>
    </div>
  );
}

export function RemoveMemberButton({ organizationId, memberId, name }: { organizationId: string; memberId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Remove ${name}? They'll lose access right away.`)) return;
        setBusy(true);
        const { error } = await authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId });
        setBusy(false);
        if (error) alert(error.message ?? "Couldn't remove.");
        router.refresh();
      }}
    >
      Remove
    </button>
  );
}
