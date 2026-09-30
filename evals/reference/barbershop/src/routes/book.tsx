import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, Button, Field } from '#/components/ui'
import { bookingInput, fieldErrors } from '#/lib/booking'
import { createBooking, getBookingOptions, getFreeTimes } from '#/server/booking'

export const Route = createFileRoute('/book')({
  loader: () => getBookingOptions(),
  component: BookPage,
})

function BookPage() {
  const { barbers, services } = Route.useLoaderData()
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? '')
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [times, setTimes] = useState<Array<string>>([])
  const [time, setTime] = useState('')
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [failure, setFailure] = useState<string>()
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    if (!barberId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setTimes([])
      return
    }
    void getFreeTimes({ data: { barberId, date } }).then((free) => {
      if (!active) return
      setTimes(free)
      setTime((current) => (free.includes(current) ? current : (free[0] ?? '')))
    })
    return () => {
      active = false
    }
  }, [barberId, date])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = bookingInput.safeParse({ barberId, serviceId, date, time, clientName: form.get('clientName'), clientPhone: form.get('clientPhone') })
    setFailure(undefined)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    const result = await createBooking({ data: parsed.data })
    if (result.ok) setDone(true)
    else setFailure(result.error)
  }

  if (done) {
    return (
      <section>
        <h1>Book a visit</h1>
        <Alert kind="success">Booking confirmed</Alert>
      </section>
    )
  }

  return (
    <section className="max-w-md">
      <h1>Book a visit</h1>
      <form onSubmit={onSubmit} noValidate>
        {failure ? <Alert>{failure}</Alert> : null}
        <label className="mb-1 block text-sm font-medium" htmlFor="barber">
          Barber
        </label>
        <select id="barber" className="mb-4 w-full rounded-md border px-3 py-2" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <label className="mb-1 block text-sm font-medium" htmlFor="service">
          Service
        </label>
        <select id="service" className="mb-4 w-full rounded-md border px-3 py-2" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Field label="Date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <label className="mb-1 block text-sm font-medium" htmlFor="time">
          Time
        </label>
        <select id="time" className="mb-1 w-full rounded-md border px-3 py-2" value={time} onChange={(e) => setTime(e.target.value)}>
          {times.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <p className="mb-4 text-sm text-red-700">{errors.time && !errors.date ? errors.time : ''}</p>
        <Field label="Your name" name="clientName" error={errors.clientName} />
        <Field label="Phone" name="clientPhone" type="tel" error={errors.clientPhone} />
        <Button type="submit">Book</Button>
      </form>
    </section>
  )
}
