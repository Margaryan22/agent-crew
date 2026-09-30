import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, Button, Field } from '#/components/ui'
import { formatUsd, issues, orderInput } from '#/lib/orders'
import { createOrder, listProducts } from '#/server/orders'

export const Route = createFileRoute('/_app/orders/new')({
  loader: () => listProducts(),
  component: NewOrderPage,
})

type Row = { productId: string; quantity: string }

function NewOrderPage() {
  const products = Route.useLoaderData()
  const router = useRouter()
  const [rows, setRows] = useState<Array<Row>>([{ productId: products[0]?.id ?? '', quantity: '1' }])
  const [errors, setErrors] = useState<Array<string>>([])
  const price = new Map(products.map((p) => [p.id, p.priceCents]))
  const totalCents = rows.reduce((s, r) => s + (price.get(r.productId) ?? 0) * Math.max(0, Number(r.quantity) || 0), 0)
  const update = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = orderInput.safeParse({ customerName: form.get('customerName'), phone: form.get('phone'), pickupDate: form.get('pickupDate'), items: rows })
    if (!parsed.success) return setErrors(issues(parsed.error))
    const result = await createOrder({ data: parsed.data })
    if (!result.ok) return setErrors(result.errors)
    await router.navigate({ to: '/orders/$orderId', params: { orderId: result.id }, search: { saved: true } })
  }

  return (
    <section className="max-w-lg">
      <h1>New order</h1>
      <form onSubmit={onSubmit} noValidate>
        {errors.length ? (
          <div role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        ) : null}
        <Field label="Customer name" name="customerName" />
        <Field label="Phone" name="phone" type="tel" />
        <Field label="Pickup date" name="pickupDate" type="date" />
        {rows.map((row, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <div>
              <label htmlFor={`product-${i}`} className="mb-1 block text-sm font-medium">
                Product
              </label>
              <select id={`product-${i}`} value={row.productId} onChange={(e) => update(i, { productId: e.target.value })} className="rounded-md border px-3 py-2">
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`quantity-${i}`} className="mb-1 block text-sm font-medium">
                Quantity
              </label>
              <input id={`quantity-${i}`} type="number" value={row.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className="w-24 rounded-md border px-3 py-2" />
            </div>
          </div>
        ))}
        <Button className="mb-4 bg-slate-600" onClick={() => setRows((all) => [...all, { productId: products[0]?.id ?? '', quantity: '1' }])}>
          Add item
        </Button>
        <p className="mb-4 text-lg font-semibold">Total: {formatUsd(totalCents)}</p>
        <Button type="submit">Save order</Button>
      </form>
      {products.length === 0 ? <Alert>No products yet.</Alert> : null}
    </section>
  )
}
