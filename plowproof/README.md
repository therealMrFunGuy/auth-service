# PlowProof

Customer lists, crews, and (next) proof of service for snow removal contractors.

**What's in this build**

- **Company accounts.** An owner signs in with an emailed link (no passwords) and creates their company.
- **AI customer import.** Paste a messy list, upload a CSV, an invoice PDF, or a photo of a route sheet.
  Claude pulls out names, addresses, phones, trigger depth, route order, and notes like gate codes,
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
- **Sealed on Solana.** Ending a storm writes one memo transaction holding the Merkle root of every visit.
  Each visit gets a public proof page that re-checks the record, the photos, the batch, and the chain live.
- **Proof emailed to the customer.** When a visit uploads, customers with an email on file get the proof link
  automatically (replies go to the company owner). Turn it off per customer on the Customers page. The storm page
  shows whether each email went out, with "Email customer" / "Send again" buttons.

## Stack

Next.js 16 (App Router) · Better Auth (magic link + organization plugins) · Drizzle ORM + Postgres ·
Anthropic SDK (Claude Haiku 4.5 for extraction) · Resend for email · Tailwind CSS 4 ·
US Census geocoder (free, no key) · @solana/web3.js + SPL Memo · IndexedDB (idb-keyval) for the offline queue ·
S3-compatible photo storage (R2, S3, MinIO) via aws4fetch.

## Setup

```bash
npm install
cp .env.example .env          # fill in the values
openssl rand -base64 32       # paste into BETTER_AUTH_SECRET
npm run db:migrate            # creates tables from drizzle/0000_init.sql
npm run dev
```

Open http://localhost:3000. With `RESEND_API_KEY` empty, sign-in and invite emails print to the
terminal, so you can click the links without setting up email.

For production, verify your sending domain in Resend and set `EMAIL_FROM` to an address on it.

### Solana

```bash
npm run solana:keygen         # prints a public key and SOLANA_ANCHOR_SECRET_KEY for .env
solana airdrop 1 <PUBKEY> --url devnet
```

Leave `SOLANA_CLUSTER=devnet` while testing. For mainnet set `SOLANA_CLUSTER=mainnet-beta`, point
`SOLANA_RPC_URL` at a paid RPC (Helius, Triton, QuickNode), and fund the key with a small amount of SOL.
Each storm is one transaction (about 0.000005 SOL). This key only pays fees, so keep its balance small.

For a fully local chain: `solana-test-validator`, then `SOLANA_CLUSTER=localnet` and
`SOLANA_RPC_URL=http://127.0.0.1:8899`.

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
src/lib/ai-extract.ts            Claude prompt + tool schema for customer extraction
src/app/api/import/parse/        Upload handling, chunking, duplicate detection
src/app/dashboard/import/        Review table (ImportFlow.tsx) + save action
src/app/dashboard/team/          Invites and crew list
src/app/join/[id]/               Invite landing page for drivers
src/app/driver/                  Phone route view
src/app/driver/stop/[id]/        Check-in screen (CheckIn.tsx)
src/lib/offline-queue.ts         Drafts + upload queue in IndexedDB
src/app/api/service/             Visit upload: idempotent, hashes photos server-side
src/lib/proof.ts                 Record hashing + Merkle tree (the part to audit)
src/lib/storms.ts                Storm assignment, sealing batches on Solana
src/lib/verify.ts                Live checks behind the proof page
src/lib/notify.ts                Proof email to the customer (sent once per visit)
src/app/p/[token]/               Public proof page
src/app/dashboard/storms/        Storm list, visit review, End storm / seal
src/db/schema.ts                 customer table (+ re-exports Better Auth tables)
```

## Notes

- **Model.** Defaults to `claude-haiku-4-5-20251001`. Set `ANTHROPIC_MODEL` to use a larger model
  if you see misreads on handwritten route sheets.
- **Large lists.** Text over 120 rows is split into chunks (header row repeated) and read 4 at a time.
- **Excel.** `.xlsx` is rejected with a prompt to export as CSV, which avoids a spreadsheet parser dependency.
- **Geocoding** runs after the save response (Next.js `after()`), so saves feel instant.
  Addresses the Census geocoder can't find are marked on the Customers page; "Retry map lookup" re-runs pending ones.
- **Changing auth plugins?** Run `npm run auth:generate`, then `npm run db:generate && npm run db:migrate`.

## How the proof works

1. When a visit is uploaded, the server hashes each photo (SHA-256 of the exact stored bytes), then hashes
   the record: a fixed-order JSON array of the visit id, company, storm, property, address, driver, start and
   finish times, GPS, photo hashes, and notes (`src/lib/proof.ts`). Records are never edited after this.
2. Sealing a storm puts every unsealed record hash into a Merkle tree (0x00 leaf prefix, 0x01 node prefix)
   and writes `plowproof:v1:<batch id>:<root>` to Solana with the SPL Memo program.
3. The proof page recomputes the record hash, re-hashes the photos from storage, rebuilds the Merkle path,
   and reads the memo back from the chain. Change any byte of the record or a photo and it shows as failed.
   Other customers' visits in the same batch are never revealed; only sibling hashes are.

Visits logged after a storm is sealed get sealed in a new batch ("Seal now" on the storm page).
If Solana can't be reached, the batch is saved and "Try again" re-sends the same root.

Proof links are unguessable (192-bit tokens) and not indexed by search engines, but anyone with the link can
see the address and photos. Share them with the customer or insurer who needs them.

## Next ideas

- Text (SMS) the proof link to customers who have a phone but no email.
- PDF storm report per customer for invoicing and slip-and-fall disputes.
- Route ordering by distance within each priority group.
- Per-company time zone setting (currently `APP_TIMEZONE`).
