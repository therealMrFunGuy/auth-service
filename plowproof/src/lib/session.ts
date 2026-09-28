import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { member, organization } from "@/db/schema";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Signed-in user or bounce to sign-in. */
export async function requireUser(next?: string) {
  const session = await getSession();
  if (!session) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return session;
}

export type Membership = {
  memberId: string;
  role: string;
  organizationId: string;
  organizationName: string;
};

/**
 * The org this user is working in: the session's active org if they still belong to it,
 * otherwise their first membership. Read straight from the DB so it never needs to set cookies.
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const session = await getSession();
  if (!session) return null;
  const rows = await db
    .select({
      memberId: member.id,
      role: member.role,
      organizationId: organization.id,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(member.createdAt);
  if (rows.length === 0) return null;
  return rows.find((r) => r.organizationId === session.session.activeOrganizationId) ?? rows[0];
});

export const isDispatcher = (role: string) => role === "owner" || role === "admin";

/** Any member of an org (drivers included). No org yet → onboarding. */
export async function requireMembership() {
  const session = await requireUser();
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  return { session, membership };
}

/** Owners and admins only. Drivers get sent to their route view. */
export async function requireDispatcher() {
  const ctx = await requireMembership();
  if (!isDispatcher(ctx.membership.role)) redirect("/driver");
  return ctx;
}

/** Scoped lookup used by server actions to be sure a row belongs to the caller's org. */
export async function assertMemberOf(userId: string, organizationId: string) {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)));
  return row ?? null;
}
