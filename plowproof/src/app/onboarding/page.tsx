import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { getMembership, requireUser } from "@/lib/session";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await requireUser("/onboarding");
  if (await getMembership()) redirect("/");

  return (
    <AuthCard
      title="Set up your company"
      intro="This is the account your customers and drivers live under. Drivers join it from an email invite."
    >
      <OnboardingForm defaultName={session.user.name} />
    </AuthCard>
  );
}
