import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { Wordmark } from "@/components/Wordmark";
import { requireDispatcher } from "@/lib/session";
import { DashboardNav } from "./DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, membership } = await requireDispatcher();

  return (
    <div className="min-h-dvh">
      <div className="hazard" />
      <header className="border-b border-frost bg-salt">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3">
          <Link href="/dashboard" className="flex items-baseline gap-3">
            <Wordmark />
            <span className="text-slush">{membership.organizationName}</span>
          </Link>
          <DashboardNav />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/driver" className="text-sm font-semibold underline-offset-4 hover:underline">Driver view</Link>
            <span className="hidden text-sm text-slush sm:inline">{session.user.email}</span>
            <SignOutButton className="btn btn-quiet min-h-9 px-3 text-sm" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
