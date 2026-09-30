import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, gte, inArray, lte, ne, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/db.server'
import { orderItems, orders, products } from '#/db/schema'
import { NEXT, orderInput } from '#/lib/orders'
import type { OrderStatus } from '#/lib/orders'
import { requireUser } from './session.server'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const total = sql<number>`coalesce((select sum(oi.quantity * oi.price_cents) from order_items oi where oi.order_id = "orders"."id"), 0)`.mapWith(Number)

export const listProducts = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser()
  return db.select().from(products).orderBy(asc(products.name))
})

export const createOrder = createServerFn({ method: 'POST' })
  .validator(orderInput)
  .handler(async ({ data }) => {
    await requireUser()
    const prices = await db.select().from(products).where(inArray(products.id, data.items.map((i) => i.productId)))
    const priceOf = new Map(prices.map((p) => [p.id, p.priceCents]))
    if (data.items.some((i) => !priceOf.has(i.productId))) return { ok: false as const, errors: ['Choose a product'] }
    const order = await db.transaction(async (tx) => {
      const [row] = await tx.insert(orders).values({ customerName: data.customerName, phone: data.phone, pickupDate: data.pickupDate }).returning({ id: orders.id, number: orders.number })
      await tx.insert(orderItems).values(data.items.map((i) => ({ orderId: row!.id, productId: i.productId, quantity: i.quantity, priceCents: priceOf.get(i.productId)! })))
      return row!
    })
    return { ok: true as const, id: order.id, number: order.number }
  })

export const getOrder = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireUser()
    const [order] = await db.select({ id: orders.id, number: orders.number, customerName: orders.customerName, phone: orders.phone, pickupDate: orders.pickupDate, status: orders.status, total }).from(orders).where(eq(orders.id, data.id)).limit(1)
    if (!order) return null
    const items = await db.select({ product: products.name, quantity: orderItems.quantity, priceCents: orderItems.priceCents }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id)).where(eq(orderItems.orderId, order.id))
    return { ...order, status: order.status as OrderStatus, items }
  })

export const listOrders = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate }))
  .handler(async ({ data }) => {
    await requireUser()
    const rows = await db.select({ id: orders.id, number: orders.number, customerName: orders.customerName, status: orders.status, total }).from(orders).where(eq(orders.pickupDate, data.date)).orderBy(asc(orders.number))
    return rows.map((r) => ({ ...r, status: r.status as OrderStatus }))
  })

export const setStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), status: z.enum(['baking', 'ready', 'picked_up', 'cancelled']) }))
  .handler(async ({ data }) => {
    await requireUser()
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, data.id)).limit(1)
    if (!order) return { ok: false as const, error: 'Order not found' }
    const current = order.status as OrderStatus
    const allowed = data.status === 'cancelled' ? current !== 'picked_up' && current !== 'cancelled' : NEXT[current]?.status === data.status
    if (!allowed) return { ok: false as const, error: 'This change is not possible now' }
    await db.update(orders).set({ status: data.status }).where(eq(orders.id, data.id))
    return { ok: true as const }
  })

export const getProduction = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate }))
  .handler(async ({ data }) => {
    await requireUser()
    return db
      .select({ product: products.name, quantity: sum(orderItems.quantity).mapWith(Number) })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(and(eq(orders.pickupDate, data.date), ne(orders.status, 'cancelled')))
      .groupBy(products.name)
      .orderBy(asc(products.name))
  })

export const getRevenue = createServerFn({ method: 'GET' })
  .validator(z.object({ from: isoDate, to: isoDate }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    const [row] = await db
      .select({ cents: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.priceCents}), 0)`.mapWith(Number) })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(gte(orders.pickupDate, data.from), lte(orders.pickupDate, data.to), eq(orders.status, 'picked_up')))
    return { cents: row?.cents ?? 0 }
  })
