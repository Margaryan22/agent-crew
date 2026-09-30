---
name: tanstack-reports
description: Reports in the tanstack profile — totals and per-day/month aggregates with Drizzle (count, sum, date_trunc), date ranges and time zones, money formatting, report pages with totals rows, and CSV export through a server route. Use when a task asks for a report, statistics, totals or an export.
user-invocable: false
paths:
  - src/server/reports*
  - src/routes/**/reports/**
  - src/routes/api/**
---

# Reports and exports

The owner wants a few numbers they trust: counts and money per period, per staff member or per status. Compute them in SQL, show them in a table with a total row, and offer CSV.

## Query (`src/server/reports.server.ts`)

```ts
import { and, count, gte, lt, sql, sum } from 'drizzle-orm'
import { db } from '#/db/db.server'
import { visits } from '#/db/schema'

export type RevenueRow = { month: string; visits: number; revenueCents: number }

export async function revenueByMonth(from: Date, to: Date): Promise<Array<RevenueRow>> {
  const month = sql<string>`to_char(date_trunc('month', ${visits.visitedAt}), 'YYYY-MM')`
  const rows = await db
    .select({ month, visits: count(), revenueCents: sum(visits.amountCents).mapWith(Number) })
    .from(visits)
    .where(and(gte(visits.visitedAt, from), lt(visits.visitedAt, to)))
    .groupBy(month)
    .orderBy(month)
  return rows.map((r) => ({ month: r.month, visits: r.visits, revenueCents: r.revenueCents }))
}
```

- `sum()` returns a string (Postgres numeric) — `.mapWith(Number)`; `count()` is a number.
- Ranges are half-open: `>= from` and `< to`.
- Per day: `date_trunc('day', col)`; per staff member: `groupBy(visits.staffId)` with an `innerJoin` for the name.
- **Time zones**: `date_trunc` uses the database session's zone (UTC in the template). When the business is elsewhere, group in its zone: `date_trunc('day', ${col} AT TIME ZONE 'Europe/Moscow')` with the zone from `docs/architecture.md`.
- Periods with no data are missing from the result; fill them in code when the report must show zeros.

## Server function and page

```ts
export const getRevenueReport = createServerFn({ method: 'GET' })
  .validator(z.object({ year: z.number().int().min(2000).max(2100) }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    const rows = await revenueByMonth(new Date(Date.UTC(data.year, 0, 1)), new Date(Date.UTC(data.year + 1, 0, 1)))
    return { rows, totalCents: rows.reduce((s, r) => s + r.revenueCents, 0) }
  })
```

The page (owner-only, see `tanstack-auth`) takes the period from search params, shows a table with `<th scope="col">` headers, a `<tfoot>` total row, and an empty state (`<p role="status">No visits in 2026.</p>`).

Money and dates through `src/lib/format.ts`:

```ts
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat(text.lang, { style: 'currency', currency }).format(cents / 100)
}
```

Set the currency the brief names (RUB, EUR…) once in that module.

## CSV export (server route)

```ts
// src/routes/api/reports/revenue[.]csv.ts  →  GET /api/reports/revenue.csv?year=2026
export const Route = createFileRoute('/api/reports/revenue.csv')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await currentUser()
        if (user?.role !== 'owner') return new Response('Forbidden', { status: 403 })
        const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getFullYear()
        const rows = await revenueByMonth(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)))
        return new Response(toCsv(rows), {
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="revenue-${year}.csv"` },
        })
      },
    },
  },
})
```

```ts
export function toCsv(rows: Array<RevenueRow>): string {
  const escape = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const lines = [['Month', 'Visits', 'Revenue'], ...rows.map((r) => [r.month, r.visits, (r.revenueCents / 100).toFixed(2)])]
  return `${lines.map((l) => l.map(escape).join(',')).join('\n')}\n`
}
```

Link to it with a plain `<a href="/api/reports/revenue.csv?year=2026" download>Download CSV</a>`. For spreadsheets in some locales, a `;` separator and a UTF-8 BOM help; follow the brief.

Charts are out of scope unless the brief asks; a clear table with totals answers most owners' questions.
