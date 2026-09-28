import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { MagicLinkForm } from "@/components/MagicLinkForm";
import { getSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);

  return (
    <AuthCard
      title="Sign in"
      intro="Enter your work email and we'll send you a link. No password to remember in a storm."
    >
      <MagicLinkForm callbackURL={next} />
      <p className="hint mt-8">
        Drivers: use the invite email from your company. It connects your phone to their account.
      </p>
    </AuthCard>
  );
}
