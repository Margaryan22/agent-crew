import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { getCurrentUser, signOut } from '#/server/auth'
import type { CurrentUser } from '#/lib/roles'
import { text } from '#/lib/text'
import appCss from '#/styles.css?url'

export const Route = createRootRoute({
  // The signed-in user (or null) is in the context of every route: `context.user`.
  beforeLoad: async () => ({ user: await getCurrentUser() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: text.appName },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={text.lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const { user } = Route.useRouteContext()
  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </>
  )
}

function Header({ user }: { user: CurrentUser | null }) {
  const router = useRouter()
  async function onSignOut() {
    await signOut()
    await router.invalidate()
    await router.navigate({ to: '/login' })
  }
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link to="/" className="font-semibold">
          {text.appName}
        </Link>
        {user ? (
          <>
            <Link to="/dashboard" activeProps={{ className: 'underline' }}>
              {text.dashboard}
            </Link>
            <span className="ml-auto text-sm text-slate-600">{user.name}</span>
            <button type="button" onClick={onSignOut} className="text-sm underline">
              {text.signOut}
            </button>
          </>
        ) : (
          <Link to="/login" className="ml-auto text-sm underline">
            {text.signIn}
          </Link>
        )}
      </nav>
    </header>
  )
}

function NotFound() {
  return (
    <section>
      <h1>{text.notFound}</h1>
      <Link to="/" className="underline">
        {text.backHome}
      </Link>
    </section>
  )
}
