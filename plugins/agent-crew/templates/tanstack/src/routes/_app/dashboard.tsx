import { createFileRoute } from '@tanstack/react-router'
import { text } from '#/lib/text'

export const Route = createFileRoute('/_app/dashboard')({ component: Dashboard })

function Dashboard() {
  const { user } = Route.useRouteContext()
  return (
    <section>
      <h1>{text.dashboard}</h1>
      <p className="text-slate-600">{text.signedInAs(user.name)}</p>
    </section>
  )
}
