import { redirect } from "next/navigation";
import { getMembership, getSession, isDispatcher } from "@/lib/session";

// Traffic cop: send each person to the right screen.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  redirect(isDispatcher(membership.role) ? "/dashboard" : "/driver");
}
