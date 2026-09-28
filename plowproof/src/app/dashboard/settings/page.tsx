import type { Metadata } from "next";
import { getSettings } from "@/lib/company";
import { requireDispatcher } from "@/lib/session";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { membership } = await requireDispatcher();
  const s = await getSettings(membership.organizationId);
  return (
    <section className="max-w-xl">
      <h1 className="sign text-4xl font-bold">Settings</h1>
      <p className="mt-2 text-slush">These apply to everyone at {membership.organizationName}.</p>
      <div className="mt-6 rounded border border-frost bg-salt p-5">
        <SettingsForm timezone={s.timezone} yardAddress={s.yardAddress ?? ""} yardMapped={s.yard != null} />
      </div>
    </section>
  );
}
