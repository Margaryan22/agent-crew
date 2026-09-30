import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Button, Field } from '#/components/ui'
import { today } from '#/lib/stock'
import { movementReport } from '#/server/stock'

export const Route = createFileRoute('/_app/reports')({
  validateSearch: z.object({ from: z.string().optional(), to: z.string().optional() }),
  loaderDeps: ({ search }) => ({ from: search.from ?? today(), to: search.to ?? today() }),
  loader: async ({ deps }) => ({ ...deps, rows: await movementReport({ data: deps }) }),
  component: ReportPage,
})

function ReportPage() {
  const { from, to, rows } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void navigate({ search: { from: String(form.get('from')), to: String(form.get('to')) } })
  }
  return (
    <section>
      <h1>Movements</h1>
      <form onSubmit={onSubmit} className="flex items-end gap-4">
        <Field label="From" name="from" type="date" defaultValue={from} />
        <Field label="To" name="to" type="date" defaultValue={to} />
        <div className="mb-4">
          <Button type="submit">Show</Button>
        </div>
      </form>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Received</th>
            <th scope="col">Shipped</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product}>
              <td>{r.product}</td>
              <td>{r.received}</td>
              <td>{r.shipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
