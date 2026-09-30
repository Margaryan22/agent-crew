import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq, gte, isNull, lte, sum } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/db.server'
import { barbers, bookings, services } from '#/db/schema'
import { OPENING_TIMES, bookingInput, today } from '#/lib/booking'
import { requireUser } from './session.server'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Public: what the booking form offers.
export const getBookingOptions = createServerFn({ method: 'GET' }).handler(async () => {
  const [barberRows, serviceRows] = await Promise.all([
    db.select({ id: barbers.id, name: barbers.name }).from(barbers).orderBy(asc(barbers.name)),
    db.select().from(services).orderBy(asc(services.name)),
  ])
  return { barbers: barberRows, services: serviceRows }
})

// Public: free start times of a barber on a day.
export const getFreeTimes = createServerFn({ method: 'GET' })
  .validator(z.object({ barberId: z.uuid(), date: isoDate }))
  .handler(async ({ data }) => {
    if (data.date < today()) return []
    const taken = await db
      .select({ time: bookings.time })
      .from(bookings)
      .where(and(eq(bookings.barberId, data.barberId), eq(bookings.date, data.date), isNull(bookings.cancelledAt)))
    const busy = new Set(taken.map((t) => t.time))
    return OPENING_TIMES.filter((t) => !busy.has(t))
  })

// Public: clients book without an account.
export const createBooking = createServerFn({ method: 'POST' })
  .validator(bookingInput)
  .handler(async ({ data }) => {
    try {
      await db.insert(bookings).values(data)
      return { ok: true as const }
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') return { ok: false as const, error: 'This time is no longer available' }
      throw err
    }
  })

export const getSchedule = createServerFn({ method: 'GET' })
  .validator(z.object({ date: isoDate }))
  .handler(async ({ data }) => {
    const user = await requireUser('owner', 'barber')
    const conditions = [eq(bookings.date, data.date), isNull(bookings.cancelledAt)]
    if (user.role === 'barber') conditions.push(eq(barbers.userId, user.id))
    return db
      .select({ id: bookings.id, time: bookings.time, barber: barbers.name, service: services.name, client: bookings.clientName, phone: bookings.clientPhone })
      .from(bookings)
      .innerJoin(barbers, eq(bookings.barberId, barbers.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(and(...conditions))
      .orderBy(asc(bookings.time), asc(barbers.name))
  })

export const cancelBooking = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    await db.update(bookings).set({ cancelledAt: new Date() }).where(eq(bookings.id, data.id))
    return { ok: true as const }
  })

export const getRevenue = createServerFn({ method: 'GET' })
  .validator(z.object({ from: isoDate, to: isoDate }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    const [row] = await db
      .select({ bookings: count(), totalCents: sum(services.priceCents).mapWith(Number) })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(and(gte(bookings.date, data.from), lte(bookings.date, data.to), isNull(bookings.cancelledAt)))
    return { bookings: row?.bookings ?? 0, totalCents: row?.totalCents ?? 0 }
  })
