import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '#/components/ui'
import { today } from '#/lib/booking'
import { hasRole } from '#/lib/roles'
import { cancelBooking, getSchedule } from '#/server/booking'

export const Route = createFileRoute('/_app/schedule')({
  validateSearch: z.object({ date: z.string().optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? today() }),
  loader: async ({ deps }) => ({ date: deps.date, rows: await getSchedule({ data: deps }) }),
  component: SchedulePage,
})

function SchedulePage() {
  const { date, rows } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [confirming, setConfirming] = useState<string>()
  const owner = hasRole(user, 'owner')

  return (
    <section>
      <h1>Schedule</h1>
      <label className="mb-1 block text-sm font-medium" htmlFor="schedule-date">
        Date
      </label>
      <input id="schedule-date" type="date" className="mb-4 rounded-md border px-3 py-2" value={date} onChange={(e) => void navigate({ search: { date: e.target.value } })} />
      {rows.length === 0 ? (
        <p role="status">No bookings on this day.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Barber</th>
              <th scope="col">Service</th>
              <th scope="col">Client</th>
              {owner ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.time}</td>
                <td>{r.barber}</td>
                <td>{r.service}</td>
                <td>
                  {r.client} · {r.phone}
                </td>
                {owner ? (
                  <td>
                    {confirming === r.id ? (
                      <Button
                        className="bg-red-700"
                        onClick={async () => {
                          await cancelBooking({ data: { id: r.id } })
                          setConfirming(undefined)
                          await router.invalidate()
                        }}
                      >
                        Yes, cancel
                      </Button>
                    ) : (
                      <Button onClick={() => setConfirming(r.id)}>Cancel</Button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
