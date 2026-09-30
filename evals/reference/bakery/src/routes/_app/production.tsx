import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { today } from '#/lib/orders'
import { getProduction } from '#/server/orders'

export const Route = createFileRoute('/_app/production')({
  validateSearch: z.object({ date: z.string().optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? today() }),
  loader: async ({ deps }) => ({ date: deps.date, rows: await getProduction({ data: deps }) }),
  component: ProductionPage,
})

function ProductionPage() {
  const { date, rows } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <section>
      <h1>Production</h1>
      <label htmlFor="production-date" className="mb-1 block text-sm font-medium">
        Pickup date
      </label>
      <input id="production-date" type="date" value={date} onChange={(e) => void navigate({ search: { date: e.target.value } })} className="mb-4 rounded-md border px-3 py-2" />
      {rows.length === 0 ? (
        <p role="status">Nothing to bake for this day.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.product}>
              {r.product} — {r.quantity}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
