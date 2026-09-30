import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { STATUS_LABELS, formatUsd, today } from '#/lib/orders'
import { listOrders } from '#/server/orders'

export const Route = createFileRoute('/_app/orders/')({
  validateSearch: z.object({ date: z.string().optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? today() }),
  loader: async ({ deps }) => ({ date: deps.date, rows: await listOrders({ data: deps }) }),
  component: OrdersPage,
})

function OrdersPage() {
  const { date, rows } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1>Orders</h1>
        <Link to="/orders/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          New order
        </Link>
      </div>
      <label htmlFor="pickup-date" className="mb-1 block text-sm font-medium">
        Pickup date
      </label>
      <input id="pickup-date" type="date" value={date} onChange={(e) => void navigate({ search: { date: e.target.value } })} className="mb-4 rounded-md border px-3 py-2" />
      {rows.length === 0 ? (
        <p role="status">No orders for this day.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Customer</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to="/orders/$orderId" params={{ orderId: o.id }} className="underline">
                    #{o.number}
                  </Link>
                </td>
                <td>{o.customerName}</td>
                <td>{formatUsd(o.total)}</td>
                <td>{STATUS_LABELS[o.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
