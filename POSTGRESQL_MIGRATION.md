# PostgreSQL Migration

The active API now uses Prisma/PostgreSQL. MongoDB is retained only for the one-time importer in `scripts/migrate-mongodb-to-postgres.js`; the inactive singular/dotted files at the repository root are not used by `server.js`.

## Required Environment

Set `DATABASE_URL` to a PostgreSQL connection string for the app and deploy environment. For local migration only, also set `MONGODB_URI` to the source MongoDB connection string. Never commit either value. For automated integration tests, set `TEST_DATABASE_URL` to a separate disposable PostgreSQL database whose database name contains `test`.

For the pre-launch checkout, explicitly set `PAYMENT_MODE=prelaunch_simulated` in the backend environment. This only enables the clearly labelled course-payment simulation endpoint; no bank/mobile-money charge or payout is performed. Without the setting, simulated course completion is rejected. Apply all checked-in migrations before deploying this mode.

## Safe Data Cutover

1. Take a verified MongoDB backup and pause writes during the final copy.
2. Provision PostgreSQL and set `DATABASE_URL` locally.
3. Install dependencies and generate the Prisma client: `npm install` then `npm run db:generate`.
4. Create the initial PostgreSQL schema from the checked-in migration: `npm run db:migrate`.
5. Set the source `MONGODB_URI` locally and run `npm run migrate:mongodb`. The importer preserves source Mongo IDs as string IDs, maps embedded course enrollments into a relational table, and skips duplicate primary/unique keys on reruns.
6. Compare source/import counts from the importer output and verify representative users, courses, enrollments, freelancers, transactions, messages, and WhatsApp history before changing production traffic.
7. Set the production Render `DATABASE_URL` to PostgreSQL, set `PAYMENT_MODE=prelaunch_simulated` only while the platform is in pre-launch testing, deploy this backend, and smoke-test login, simulated course checkout, enrollment access, chat, financial reports, project payment reporting, withdrawal review, and admin routes.
8. Keep the MongoDB backup until those production checks pass. Do not remove the source database before verifying the imported data and deployed application.

The importer is designed to be repeatable by ID, but it is not a continuous dual-write or sync mechanism. Pause writes for the final import to avoid missing changes.

## Tests

`npm test` runs the PostgreSQL payment integration tests only when `TEST_DATABASE_URL` is set; it refuses database names without `test`. Without that variable, integration tests are reported as skipped. Use a disposable PostgreSQL instance; never point this variable at production.

`npm run db:push` is available for disposable local development only. For deployed environments, add checked-in Prisma migration files and apply them with `npm run db:migrate`.

## Frontend API Coverage

The current frontend/backend contract includes:

- Admin payment review through `PUT /api/admin/transactions/:id/approve` and `/reject`; enrollment and wallet settlement happen atomically in that endpoint.
- Enrolled course progress through `GET` and `POST /api/courses/:id/progress`; the server derives completion percentages from valid completed lesson indices.
- Certificate verification through `GET /api/courses/:id/certificate`; only the enrolled student with a completed enrollment receives a certificate response.
- Freelancer hire requests through `POST /api/freelancers/:id/hire-requests` and owner-scoped `GET /api/freelancers/hire-requests`; requests are answered through in-app chat.
- Admin exchange rates through `GET` and `POST /api/admin/settings/exchange-rates`.
- Pre-launch course simulation through authenticated `POST /api/payments/checkout` and `POST /api/payments/simulate`; simulation entries are marked and never credited to real wallets.
- Course commission configuration through admin `GET`/`PUT /api/admin/settings/commission`, with the rate snapshot stored on new course orders.
- Financial reporting through `GET /api/admin/financial-report`; recorded courses, simulated courses, external freelance reports, and withdrawals are separated and grouped by currency.
- Direct client/freelancer project agreements and external payment reports through `/api/freelancers/projects`; client confirmation and admin verification are required before a report is shown as verified external activity. Reported external payments never count as SkillHub cash.
- Internal withdrawal requests and refund requests through `/api/payments/withdrawal-requests` and `/api/payments/refund-requests`; admin review records decisions only and does not transfer or return money.
- Chat user search through `/api/users/search` and `/api/auth/users`, and short-lived participant-scoped typing signals through `/api/chat/typing`.
- Contact submission through `POST /api/contact` and admin-only moderation listing through `GET /api/contact/messages`.

The pre-launch project workflow records agreed project terms and direct external payment reports; it does not yet include a full proposal marketplace, contract signing, milestone invoicing, or a real payment gateway. Refund approvals and withdrawal completions are records only. These are local code and integration-test results. Production MongoDB import, Render/PostgreSQL environment configuration, and publishing the sibling frontend still require the appropriate database and deployment access.
