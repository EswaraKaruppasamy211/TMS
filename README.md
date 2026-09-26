# TMSN local dashboard

A private, localhost-only meeting roster dashboard backed by PostgreSQL. Supabase PostgreSQL is supported. The app binds only to `127.0.0.1`; its admin credentials and database connection are read only from environment variables.

## Project structure

- `frontend/` contains the HTML, CSS, and browser-side JavaScript.
- `backend/` contains the Express server, application services, configuration, and tests.
- `data/` contains the PostgreSQL schema, database access, and schema initialization script.
- The root `package.json` provides the commands for the full application.

## Start locally

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env`, then set your Supabase PostgreSQL connection string, admin username/password, and a random `SESSION_SECRET` of at least 32 characters. Never commit `.env`.
3. In Supabase, allow the connection from this computer and copy the PostgreSQL connection string (use the direct or session-pooler connection details appropriate for your network).
4. Install dependencies and initialize the schema:

   ```sh
   npm install
   npm run db:init
   ```

5. Start the dashboard:

   ```sh
   npm start
   ```

6. Open **http://127.0.0.1:3000** and sign in with the values you configured in `.env`.

The database is not seeded. Add the real student roster in **Active roster** before generating a report; weekday reports require 15 eligible students, while Friday/Saturday reports require 13. Students are appended in rotation order. No demo students or credentials are created.

## Dashboard

- The authenticated dashboard generates (idempotently) and shows only the next calendar day's report in `Asia/Kolkata`.
- College Leave is managed separately from individual OD/Leave, is persisted in PostgreSQL, and skips the marked date without generating a schedule or advancing rotation. The dashboard identifies skipped college-leave dates and displays the next valid schedule.
- Monday–Thursday use the 15-role routine: 3 Prepared Speakers, 3 Specific Evaluators, 3 Table Topic Speakers, and Timer, AH Counter, Grammarian, TMOD, GE, and TTM. Friday/Saturday use Group A (5), Group B (5), Timer, Counter, and Grammarian.
- Rotation follows the active roster order, wraps around, skips date-specific OD/Leave, and scores roles against prior active role history.
- OD and Leave are separate records per student and date. If a rostered student becomes unavailable, an eligible replacement is assigned; the original student, replacement, reason, and change audit remain recorded.
- The optional manual override and extra assignment validate the active roster and date availability and add audit/history records. Manually assigned students are skipped for the immediately following report only.
- Reports can be finalized, completed, and viewed from the historical archive. Completion is allowed only after finalization.
- **Reset schedules from the beginning** clears saved schedules and their assignment history, OD/Leave availability, and college-leave dates, then resets rotation to the first roster position. It requires confirmation and preserves students and app settings.
- Adding or deactivating students is available in the roster table. Inactive students are skipped without erasing their rotation history.

## Database and security notes

`data/db/schema.sql` is the repeatable PostgreSQL schema initializer; `npm run db:init` is safe to rerun. It creates tables and defaults only—no student data. The PostgreSQL schema replaces the former Mongoose persistence; MongoDB is not used.

The dashboard uses a local in-memory Express session store, so signing out or restarting the process ends browser sessions. Session cookies are HTTP-only and SameSite strict. For local use, keep the browser on `127.0.0.1`; do not expose this development server to a network. PostgreSQL access is through `DATABASE_URL`. Supabase hosts use TLS.

## Development

```sh
npm test
```

Tests for date handling, rotation, and report formatting run without a database. Database-backed routes require a configured PostgreSQL service.
