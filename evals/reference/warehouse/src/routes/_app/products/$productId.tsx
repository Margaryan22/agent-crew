import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Alert, Button, Field } from '#/components/ui'
import { hasRole } from '#/lib/roles'
import { deleteProduct, getProduct, recordMovement } from '#/server/stock'

export const Route = createFileRoute('/_app/products/$productId')({
  validateSearch: z.object({ saved: z.boolean().optional() }),
  loader: async ({ params }) => {
    const product = await getProduct({ data: { id: params.productId } })
    if (!product) throw notFound()
    return product
  },
  component: ProductPage,
})

function ProductPage() {
  const product = Route.useLoaderData()
  const { saved } = Route.useSearch()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [kind, setKind] = useState<'receipt' | 'shipment'>()
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = await recordMovement({ data: { productId: product.id, kind: kind!, quantity: Number(form.get('quantity')), note: String(form.get('note') ?? '') || undefined } })
    if (!result.ok) return setError(result.error)
    setError(undefined)
    setKind(undefined)
    await router.invalidate()
  }

  return (
    <section>
      <h1>{product.name}</h1>
      {saved ? <Alert kind="success">Product saved</Alert> : null}
      <p>
        SKU {product.sku} · unit {product.unit} · minimum {product.minStock}
      </p>
      <p className="my-4 text-xl font-semibold">In stock: {product.stock}</p>
      {error ? <Alert>{error}</Alert> : null}
      <div className="mb-4 flex gap-2">
        <Button onClick={() => setKind('receipt')}>Receive</Button>
        <Button onClick={() => setKind('shipment')}>Ship</Button>
      </div>
      {kind ? (
        <form onSubmit={onSubmit} noValidate className="max-w-sm">
          <Field label="Quantity" name="quantity" type="number" min={1} />
          <Field label="Note" name="note" />
          <Button type="submit">Save</Button>
        </form>
      ) : null}
      {hasRole(user, 'owner') ? (
        <Button
          className="mt-8 bg-red-700"
          onClick={async () => {
            await deleteProduct({ data: { id: product.id } })
            await router.navigate({ to: '/products' })
          }}
        >
          Delete product
        </Button>
      ) : null}
    </section>
  )
}
