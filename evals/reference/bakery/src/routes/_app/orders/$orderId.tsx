import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Alert, Button } from '#/components/ui'
import { NEXT, STATUS_LABELS, formatUsd } from '#/lib/orders'
import { getOrder, setStatus } from '#/server/orders'

export const Route = createFileRoute('/_app/orders/$orderId')({
  validateSearch: z.object({ saved: z.boolean().optional() }),
  loader: async ({ params }) => {
    const order = await getOrder({ data: { id: params.orderId } })
    if (!order) throw notFound()
    return order
  },
  component: OrderPage,
})

function OrderPage() {
  const order = Route.useLoaderData()
  const { saved } = Route.useSearch()
  const router = useRouter()
  const [error, setError] = useState<string>()
  const next = NEXT[order.status]
  async function change(status: 'baking' | 'ready' | 'picked_up' | 'cancelled') {
    const result = await setStatus({ data: { id: order.id, status } })
    if (!result.ok) return setError(result.error)
    setError(undefined)
    await router.invalidate()
  }
  return (
    <section>
      <h1>Order #{order.number}</h1>
      {saved ? <Alert kind="success">Order saved</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <p>
        {order.customerName} · {order.phone} · pickup {order.pickupDate}
      </p>
      <ul className="my-4">
        {order.items.map((i) => (
          <li key={i.product}>
            {i.product} × {i.quantity}
          </li>
        ))}
      </ul>
      <p>Total: {formatUsd(order.total)}</p>
      <p className="my-4 text-lg font-semibold">Status: {STATUS_LABELS[order.status]}</p>
      <div className="flex gap-2">
        {next ? <Button onClick={() => void change(next.status as 'baking' | 'ready' | 'picked_up')}>{next.label}</Button> : null}
        {order.status !== 'picked_up' && order.status !== 'cancelled' ? (
          <Button className="bg-red-700" onClick={() => void change('cancelled')}>
            Cancel order
          </Button>
        ) : null}
      </div>
    </section>
  )
}
