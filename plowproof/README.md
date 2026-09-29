# PlowProof

Customer lists, crews, and (next) proof of service for snow removal contractors.

**What's in this build**

- **Company accounts.** An owner signs in with an emailed link (no passwords) and creates their company.
- **AI customer import.** Paste a messy list, upload a CSV, an invoice PDF, or a photo of a route sheet.
  An AI model (free, through OpenRouter) pulls out names, addresses, phones, trigger depth, route order, and notes like gate codes,
  flags anything it guessed, and catches duplicates (`2140 4th Street` = `2140 4th St.`).
  Nothing saves until the owner reviews and edits the table.
- **Driver invites.** Owner enters a driver's email. The driver taps the link on their phone,
  confirms it's them, adds their name, and is attached to the company. Invites can be resent or cancelled,
  and only the invited email address can accept.
- **Driver view.** A night-friendly phone screen with each stop grouped by route order,
  with notes in amber and a one-tap "Go" button for turn-by-turn directions.
- **Proof of service.** At each stop the driver taps Start, takes photos, and taps Done. The phone records
  both times and a GPS fix, shrinks photos to ~300 KB, and uploads. With no signal, the visit is saved on the
  phone and uploads by itself later. A visit in progress survives a locked screen or a refresh.
- **Storms.** Visits group into storms automatically. The office sees who did what, when, from how far away
  (anything over 150 m is flagged), and which properties are still waiting.
- **Proof pages.** Each visit is fingerprinted (SHA-256) when it uploads and gets a public proof page that
  re-checks the record and photos live, so any later edit shows up.
- **Route order.** Each driver's route runs first-out stops first, then standard, then last, and within each
  group orders stops by distance, starting from the company yard (nearest-neighbor, then 2-opt). The next stop
  is highlighted.
- **PDF reports.** Per customer for any date range (defaults to the season, July 1 on), with times, GPS check,
  notes, up to 3 photos per visit, and clickable proof links — for invoices and slip-and-fall
  claims. Per storm for the office. Each customer has a page with their full visit history.
- **Company settings.** Time zone (picked up from the owner's browser at sign-up) and yard address.
- **Proof sent to the customer.** When a visit uploads, the customer gets the proof link by email (on by default
  when there's an address; replies go to the company owner) and/or by text (off by default; turn it on only for
  customers who agreed to texts). Both are per-customer toggles on the Customers page. The storm page shows what
  went out, with "Email/Text customer" and "again" buttons.

## Stack

Next.js 16 (App Router) · Better Auth (magic link + organization plugins) · Drizzle ORM + Postgres ·
OpenRouter (free Qwen model for extraction) · Resend for email · Twilio for texts · Tailwind CSS 4 ·
US Census geocoder (free, no key) · pdf-lib for reports · IndexedDB (idb-keyval) for the offline queue ·
S3-compatible photo storage (R2, S3, MinIO) via aws4fetch.

## Setup

```bash
npm install
cp .env.example .env          # fill in the values
openssl rand -base64 32       # paste into BETTER_AUTH_SECRET
npm run db:migrate            # creates tables from drizzle/0000_init.sql
npm run dev
npm test                      # unit tests (route ordering, proof hashing)
```

Open http://localhost:3000. With `RESEND_API_KEY` empty, sign-in and invite emails print to the
terminal, so you can click the links without setting up email. Texts do the same without `TWILIO_*`.

For production, verify your sending domain in Resend and set `EMAIL_FROM` to an address on it.

### Deploying to Vercel

1. Import the repo in Vercel with **Root Directory** `plowproof`. `vercel.json` runs the database migrations
   before each build.
2. Add Postgres from the project's **Storage** tab (Neon works; it sets `DATABASE_URL`). Pooled URLs
   (`-pooler` hosts, PgBouncer) are detected and prepared statements turned off.
3. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (the production URL),
   `RESEND_API_KEY` + `EMAIL_FROM`, and `OPENROUTER_API_KEY`. Twilio is optional.
4. Photos: on Vercel, `STORAGE_DRIVER` defaults to `db` (photos stored in Postgres), which is fine for testing.
   For a real season, set `STORAGE_DRIVER=s3` and point it at an R2 bucket.

### Testing on a real phone

Phones only allow GPS and the camera on HTTPS. With Tailscale: `tailscale serve 3000`, then open the
`https://<machine>.<tailnet>.ts.net` address on the phone and set `BETTER_AUTH_URL` to that address.

## Roles

| Better Auth role | Shown as     | Can do                                              |
| ---------------- | ------------ | --------------------------------------------------- |
| `owner`          | Owner        | Everything; created with the company                |
| `admin`          | Office staff | Import customers, invite and remove drivers         |
| `member`         | Driver       | See the route on their phone                        |

`src/lib/session.ts` has the guards: `requireMembership()` for any crew member,
`requireDispatcher()` for owner/admin. Every customer query is filtered by `organizationId`.

## Where things live

```
src/lib/auth.ts                  Better Auth config, email templates for sign-in + invites
src/lib/ai-extract.ts            OpenRouter prompt + JSON schema for customer extraction
src/app/api/import/parse/        Upload handling, chunking, duplicate detection
src/app/dashboard/import/        Review table (ImportFlow.tsx) + save action
src/app/dashboard/team/          Invites and crew list
src/app/join/[id]/               Invite landing page for drivers
src/app/driver/                  Phone route view
src/app/driver/stop/[id]/        Check-in screen (CheckIn.tsx)
src/lib/offline-queue.ts         Drafts + upload queue in IndexedDB
src/app/api/service/             Visit upload: idempotent, hashes photos server-side
src/lib/proof.ts                 Record and photo fingerprints (the part to audit)
src/lib/storms.ts                Storm assignment
src/lib/verify.ts                Live checks behind the proof page
src/lib/report.ts                PDF reports (pdf-lib, standard fonts)
src/app/api/reports/             Customer and storm PDF endpoints
src/lib/route.ts                 Route ordering (pure, unit-tested)
src/lib/company.ts               Company settings: time zone, yard
src/lib/notify.ts                Proof email and text to the customer (each sent once per visit)
src/lib/sms.ts                   Twilio sender, phone number normalizing
src/app/p/[token]/               Public proof page
src/app/dashboard/storms/        Storm list, visit review, End storm
src/db/schema.ts                 customer table (+ re-exports Better Auth tables)
```

## Notes

- **Model.** Defaults to `qwen/qwen3.8-27b:free` on OpenRouter (reads text and photos, returns strict JSON),
  falling back to OpenRouter's `openrouter/free` router if it's busy. Free models allow 20 requests a minute and
  50 a day (1,000 a day once the account has bought $10 of credits); each import uses one request per file or per
  120 rows. Set `OPENROUTER_MODEL` to a paid model if you see misreads on handwritten route sheets. PDFs are
  converted to text with OpenRouter's free parser, so scanned PDFs read best as photos instead.
- **Large lists.** Text over 120 rows is split into chunks (header row repeated) and read 2 at a time.
- **Excel.** `.xlsx` is rejected with a prompt to export as CSV, which avoids a spreadsheet parser dependency.
- **Geocoding** runs after the save response (Next.js `after()`), so saves feel instant.
  Addresses the Census geocoder can't find are marked on the Customers page; "Retry map lookup" re-runs pending ones.
- **Changing auth plugins?** Run `npm run auth:generate`, then `npm run db:generate && npm run db:migrate`.

## How the proof works

1. When a visit is uploaded, the server hashes each photo (SHA-256 of the exact stored bytes), then hashes
   the record: a fixed-order JSON array of the visit id, company, storm, property, address, driver, start and
   finish times, GPS, photo hashes, and notes (`src/lib/proof.ts`). Records are never edited after this.
2. The proof page recomputes the record hash and re-hashes the photos from storage. Change any byte of the
   record or a photo and it shows as failed.

The fingerprints catch edits to a record or photo after upload. They don't stop someone with database access
from rewriting a record and its fingerprint together; for that you'd publish the fingerprints somewhere outside
your control (a timestamping service, or adding the fingerprint to the customer's proof email).

Proof links are unguessable (192-bit tokens) and not indexed by search engines, but anyone with the link can
see the address and photos. Share them with the customer or insurer who needs them.
