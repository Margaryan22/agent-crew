# Business app

Built with [Agent Crew](https://github.com/Margaryan22/agent-crew). The brief, decisions and the final report are in `.crew/`.

## Run it locally

You need Node.js 22+ and Docker.

```bash
npm install
cp .env.example .env          # once; adjust values if needed
npm run setup                 # PostgreSQL in Docker, migrations, sample data
npm run dev                   # http://localhost:3000
```

Sign in with the owner account from `.env` (`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`). **Change that password before real use.**

## Tests

```bash
npm test                      # unit tests
npx playwright install chromium   # once
npm run test:e2e              # end-to-end tests (starts the dev server)
```

## Production

```bash
npm run build
npm run preview               # serves the production build on port 3000
```

Set `DATABASE_URL` for the production database and run `npm run db:migrate` against it before starting the app. Serve it over HTTPS (the session cookie is marked `secure` in production).
