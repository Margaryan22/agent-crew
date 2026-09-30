import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/db.server'
import { movements, products } from '#/db/schema'
import { movementInput, productInput } from '#/lib/stock'
import { requireUser } from './session.server'

// Correlated subquery: the outer column is written with its table name. Drizzle renders
// ${products.id} as a bare "id" in single-table selects, which the subquery would read as m.id.
const stock = sql<number>`coalesce((select sum(case when m.kind = 'receipt' then m.quantity else -m.quantity end) from movements m where m.product_id = "products"."id"), 0)`.mapWith(Number)

export const listProducts = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().trim().max(100).optional() }))
  .handler(async ({ data }) => {
    await requireUser()
    const where = data.q ? or(ilike(products.name, `%${data.q}%`), ilike(products.sku, `%${data.q}%`)) : undefined
    const rows = await db.select({ id: products.id, name: products.name, sku: products.sku, unit: products.unit, minStock: products.minStock, stock }).from(products).where(where).orderBy(asc(products.name))
    return rows.map((r) => ({ ...r, low: r.stock < r.minStock }))
  })

export const listLowStock = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser()
  const rows = await db.select({ id: products.id, name: products.name, sku: products.sku, minStock: products.minStock, stock }).from(products).orderBy(asc(products.name))
  return rows.filter((r) => r.stock < r.minStock)
})

export const getProduct = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireUser()
    const [row] = await db.select({ id: products.id, name: products.name, sku: products.sku, unit: products.unit, minStock: products.minStock, stock }).from(products).where(eq(products.id, data.id)).limit(1)
    return row ?? null
  })

export const createProduct = createServerFn({ method: 'POST' })
  .validator(productInput)
  .handler(async ({ data }) => {
    await requireUser('owner')
    const [taken] = await db.select({ id: products.id }).from(products).where(eq(products.sku, data.sku)).limit(1)
    if (taken) return { ok: false as const, errors: { sku: 'A product with this SKU already exists' } }
    const [row] = await db.insert(products).values(data).returning({ id: products.id })
    return { ok: true as const, id: row!.id }
  })

export const deleteProduct = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    await db.delete(products).where(eq(products.id, data.id))
    return { ok: true as const }
  })

export const recordMovement = createServerFn({ method: 'POST' })
  .validator(movementInput)
  .handler(async ({ data }) => {
    const user = await requireUser()
    return db.transaction(async (tx) => {
      // Lock the product so two shipments cannot both take the last items.
      const [locked] = await tx.select({ id: products.id }).from(products).where(eq(products.id, data.productId)).for('update')
      if (!locked) return { ok: false as const, error: 'Product not found' }
      if (data.kind === 'shipment') {
        const [row] = await tx.select({ stock }).from(products).where(eq(products.id, data.productId))
        if ((row?.stock ?? 0) < data.quantity) return { ok: false as const, error: 'Not enough stock' }
      }
      await tx.insert(movements).values({ ...data, createdBy: user.id })
      return { ok: true as const }
    })
  })

export const movementReport = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .handler(async ({ data }) => {
    await requireUser()
    const received = sql<number>`coalesce(sum(case when ${movements.kind} = 'receipt' then ${movements.quantity} else 0 end), 0)`.mapWith(Number)
    const shipped = sql<number>`coalesce(sum(case when ${movements.kind} = 'shipment' then ${movements.quantity} else 0 end), 0)`.mapWith(Number)
    return db
      .select({ product: products.name, received, shipped })
      .from(movements)
      .innerJoin(products, eq(movements.productId, products.id))
      .where(and(gte(movements.createdAt, sql`${data.from}::date`), lt(movements.createdAt, sql`${data.to}::date + 1`)))
      .groupBy(products.id, products.name)
      .orderBy(asc(products.name))
  })
