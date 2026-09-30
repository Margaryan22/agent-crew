import { createFileRoute, redirect } from '@tanstack/react-router'

// Pathless layout: every route under src/routes/_app/ requires a signed-in user.
// Role-specific pages check roles in their own beforeLoad (see the tanstack-auth skill);
// server functions check again with requireUser(), because the UI is not a security boundary.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (!context.user) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user: context.user }
  },
})
