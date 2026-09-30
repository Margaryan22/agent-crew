import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Alert, Button, Field } from '#/components/ui'
import { safeRedirect } from '#/lib/redirect'
import { text } from '#/lib/text'
import { signIn } from '#/server/auth'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ context, search }) => {
    if (context.user) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const search = Route.useSearch()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(undefined)
    try {
      const result = await signIn({
        data: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') },
      })
      if (!result.ok) {
        setError(text.wrongCredentials)
        return
      }
      await router.invalidate()
      await router.navigate({ href: safeRedirect(search.redirect) })
    } catch {
      setError(text.wrongCredentials)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1>{text.signIn}</h1>
      <form onSubmit={onSubmit} noValidate>
        {error ? <Alert>{error}</Alert> : null}
        <Field label={text.email} name="email" type="email" autoComplete="username" required />
        <Field label={text.password} name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" disabled={pending} className="w-full">
          {text.signIn}
        </Button>
      </form>
    </section>
  )
}
