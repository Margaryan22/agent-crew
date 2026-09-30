import { Link, createFileRoute } from '@tanstack/react-router'
import { text } from '#/lib/text'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { user } = Route.useRouteContext()
  return (
    <section>
      <h1>{text.appName}</h1>
      <p className="mb-6 text-slate-600">{text.homeIntro}</p>
      {user ? (
        <Link to="/dashboard" className="underline">
          {text.dashboard}
        </Link>
      ) : (
        <Link to="/login" className="underline">
          {text.signIn}
        </Link>
      )}
    </section>
  )
}
