import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitation, member, user } from "@/db/schema";
import { requireDispatcher } from "@/lib/session";
import { fmtDate } from "@/lib/time";
import { getTimezone } from "@/lib/company";
import { InviteForm, InviteActions, RemoveMemberButton } from "./TeamActions";

export const metadata: Metadata = { title: "Drivers" };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Office", member: "Driver" };

export default async function TeamPage() {
  const { session, membership } = await requireDispatcher();
  const orgId = membership.organizationId;

  const [people, invites] = await Promise.all([
    db
      .select({ memberId: member.id, role: member.role, joined: member.createdAt, name: user.name, email: user.email, userId: user.id })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, orgId))
      .orderBy(asc(member.createdAt)),
    db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
      .orderBy(desc(invitation.createdAt)),
  ]);

  const now = new Date();
  const tz = await getTimezone(orgId);
  const drivers = people.filter((p) => p.role === "member").length;

  return (
    <section className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div>
        <h1 className="sign text-4xl font-bold">Drivers</h1>
        <p className="mt-2 text-slush">
          Invite each plow driver by email. They tap the link on their phone, and they&apos;re connected to{" "}
          {membership.organizationName}.
        </p>
        <div className="mt-6 rounded border border-frost bg-salt p-5">
          <InviteForm organizationId={orgId} />
        </div>
      </div>

      <div className="space-y-10">
        <div>
          <h2 className="sign text-2xl font-bold">Waiting to join</h2>
          {invites.length === 0 ? (
            <p className="mt-2 text-slush">No open invites.</p>
          ) : (
            <ul className="mt-3 divide-y divide-frost rounded border border-frost bg-salt">
              {invites.map((inv) => {
                const expired = inv.expiresAt < now;
                return (
                  <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{inv.email}</div>
                      <div className={`text-sm ${expired ? "text-brake" : "text-slush"}`}>
                        {ROLE_LABEL[inv.role ?? "member"] ?? "Driver"},{" "}
                        {expired ? "invite expired" : `expires ${fmtDate(inv.expiresAt, tz)}`}
                      </div>
                    </div>
                    <InviteActions organizationId={orgId} invitationId={inv.id} email={inv.email} role={inv.role ?? "member"} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <h2 className="sign text-2xl font-bold">
            On the crew <span className="text-slush">({drivers} {drivers === 1 ? "driver" : "drivers"})</span>
          </h2>
          <ul className="mt-3 divide-y divide-frost rounded border border-frost bg-salt">
            {people.map((p) => (
              <li key={p.memberId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name || p.email}</div>
                  <div className="truncate text-sm text-slush">
                    {ROLE_LABEL[p.role] ?? p.role}
                    {p.name ? `, ${p.email}` : ""}
                  </div>
                </div>
                {p.role !== "owner" && p.userId !== session.user.id && (
                  <div className="ml-auto">
                    <RemoveMemberButton organizationId={orgId} memberId={p.memberId} name={p.name || p.email} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
