import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Field } from '#/components/ui'
import { hasRole } from '#/lib/roles'
import { fieldErrors, productInput } from '#/lib/stock'
import { createProduct } from '#/server/stock'

export const Route = createFileRoute('/_app/products/new')({
  beforeLoad: ({ context }) => {
    if (!hasRole(context.user, 'owner')) throw redirect({ to: '/products' })
  },
  component: NewProductPage,
})

function NewProductPage() {
  const router = useRouter()
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = productInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    const result = await createProduct({ data: parsed.data })
    if (!result.ok) return setErrors(result.errors)
    await router.navigate({ to: '/products/$productId', params: { productId: result.id }, search: { saved: true } })
  }
  return (
    <section className="max-w-md">
      <h1>New product</h1>
      <form onSubmit={onSubmit} noValidate>
        <Field label="Name" name="name" error={errors.name} />
        <Field label="SKU" name="sku" error={errors.sku} />
        <Field label="Unit" name="unit" defaultValue="pcs" error={errors.unit} />
        <Field label="Minimum stock" name="minStock" type="number" min={0} defaultValue="0" error={errors.minStock} />
        <Button type="submit">Save product</Button>
      </form>
    </section>
  )
}
