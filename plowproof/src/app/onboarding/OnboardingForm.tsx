"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (name.trim() && name.trim() !== defaultName) await authClient.updateUser({ name: name.trim() });

    // Random suffix keeps slugs unique without asking the owner to pick one.
    const slug = `${slugify(company)}-${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await authClient.organization.create({ name: company.trim(), slug });
    if (error || !data) {
      setError(error?.message ?? "The company couldn't be created. Try again.");
      setBusy(false);
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.push("/dashboard/import");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="company" className="label">Company name</label>
        <input
          id="company"
          className="input"
          autoComplete="organization"
          required
          placeholder="North Shore Snow & Ice"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <p className="hint mt-1.5">Drivers see this name on their invite.</p>
      </div>
      {error && <p role="alert" className="text-sm text-brake">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}
