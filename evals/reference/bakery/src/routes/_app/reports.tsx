import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Button, Field } from '#/components/ui'
import { formatUsd, today } from '#/lib/orders'
import { hasRole } from '#/lib/roles'
import { getRevenue } from '#/server/orders'

export const Route = createFileRoute('/_app/reports')({
  beforeLoad: ({ context }) => {
    if (!hasRole(context.user, 'owner')) throw redirect({ to: '/orders' })
  },
  validateSearch: z.object({ from: z.string().optional(), to: z.string().optional() }),
  loaderDeps: ({ search }) => ({ from: search.from ?? today(), to: search.to ?? today() }),
  loader: async ({ deps }) => ({ ...deps, ...(await getRevenue({ data: deps })) }),
  component: ReportPage,
})

function ReportPage() {
  const { from, to, cents } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void navigate({ search: { from: String(form.get('from')), to: String(form.get('to')) } })
  }
  return (
    <section>
      <h1>Revenue</h1>
      <form onSubmit={onSubmit} className="flex items-end gap-4">
        <Field label="From" name="from" type="date" defaultValue={from} />
        <Field label="To" name="to" type="date" defaultValue={to} />
        <div className="mb-4">
          <Button type="submit">Show</Button>
        </div>
      </form>
      <p className="text-lg font-semibold">Revenue: {formatUsd(cents)}</p>
    </section>
  )
}
