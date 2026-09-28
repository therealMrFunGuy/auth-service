import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink, organization } from "better-auth/plugins";
import { db, schema } from "@/db";
import { buttonEmail, sendEmail } from "@/lib/email";

const APP_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  baseURL: APP_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    // Drivers stay signed in on their phones through the whole season.
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    // Passwordless: owners and drivers sign in with an emailed link.
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        const { html, text } = buttonEmail({
          heading: "Sign in to PlowProof",
          body: "Use this button to sign in. It works once and expires in 15 minutes.",
          cta: "Sign in",
          url,
          footer: "If you didn't ask to sign in, you can ignore this email.",
        });
        await sendEmail({ to: email, subject: "Your PlowProof sign-in link", html, text });
      },
    }),
    organization({
      // Owner/admin = office/dispatch. "member" = a plow driver.
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 24 * 7,
      sendInvitationEmail: async ({ id, email, organization, inviter }) => {
        const url = `${APP_URL}/join/${id}`;
        const { html, text } = buttonEmail({
          heading: `Join ${organization.name} on PlowProof`,
          body: `${inviter.user.name || inviter.user.email} added you as a driver. Accept to see your route and log service from your phone.`,
          cta: "Accept invite",
          url,
          footer: "This invite expires in 7 days. Open it on the phone you'll use in the truck.",
        });
        await sendEmail({ to: email, subject: `You're invited to plow for ${organization.name}`, html, text });
      },
    }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
