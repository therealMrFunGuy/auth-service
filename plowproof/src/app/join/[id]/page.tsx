import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitation, member, organization } from "@/db/schema";
import { AuthCard } from "@/components/AuthCard";
import { MagicLinkForm } from "@/components/MagicLinkForm";
import { SignOutButton } from "@/components/SignOutButton";
import { getSession } from "@/lib/session";
import { AcceptInvite } from "./AcceptInvite";

export const metadata: Metadata = { title: "Join your crew" };

export default async function JoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invite] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      role: invitation.role,
      organizationId: invitation.organizationId,
      orgName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, id));

  if (!invite) {
    return (
      <AuthCard title="This invite link doesn't work" intro="It may have been cancelled. Ask the office to send you a new one.">
        <Link href="/sign-in" className="btn btn-quiet">Go to sign in</Link>
      </AuthCard>
    );
  }

  const session = await getSession();

  if (invite.status !== "pending") {
    const alreadyIn =
      session &&
      (await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, session.user.id), eq(member.organizationId, invite.organizationId)))).length > 0;
    return alreadyIn ? (
      <AuthCard title={`You're on the ${invite.orgName} crew`}>
        <Link href="/" className="btn btn-primary w-full">Open my route</Link>
      </AuthCard>
    ) : (
      <AuthCard title="This invite was already used or cancelled" intro={`Ask ${invite.orgName} to send a new invite.`}>
        <Link href="/sign-in" className="btn btn-quiet">Go to sign in</Link>
      </AuthCard>
    );
  }

  if (invite.expiresAt < new Date()) {
    return (
      <AuthCard title="This invite expired" intro={`Ask ${invite.orgName} to resend it from their Drivers page.`}>
        <span />
      </AuthCard>
    );
  }

  const title = `Join ${invite.orgName}`;
  const roleText = invite.role === "admin" ? "as office staff" : "as a driver";

  if (!session) {
    return (
      <AuthCard
        title={title}
        intro={<>You&apos;ve been invited {roleText}. We&apos;ll email a sign-in link to confirm it&apos;s you. Open it on this phone.</>}
      >
        <MagicLinkForm callbackURL={`/join/${invite.id}`} fixedEmail={invite.email} cta="Email me the link" />
      </AuthCard>
    );
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthCard
        title={title}
        intro={<>This invite is for <strong>{invite.email}</strong>, but you&apos;re signed in as <strong>{session.user.email}</strong>. Sign out, then open the invite link again.</>}
      >
        <SignOutButton className="btn btn-primary w-full" label={`Sign out of ${session.user.email}`} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} intro={<>You&apos;ve been invited {roleText}. Add your name so dispatch knows who&apos;s in which truck.</>}>
      <AcceptInvite
        invitationId={invite.id}
        organizationId={invite.organizationId}
        defaultName={session.user.name}
        destination={invite.role === "admin" ? "/dashboard" : "/driver"}
      />
    </AuthCard>
  );
}
