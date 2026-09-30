---
name: tanstack-forms
description: Forms and validation in the tanstack profile — one Zod schema shared by the form and the server function, field errors next to labelled inputs, server-side business errors, pending and success states, and parsing numbers, money, dates and choices. Use when building or changing a form or its validation.
user-invocable: false
paths:
  - src/components/**
  - src/lib/validation/**
  - src/routes/**
---

# Forms and validation

Validate twice with **one schema**: in the browser for instant messages, on the server for safety.

## 1. Schema (`src/lib/validation/<area>.ts`, backend owns it)

```ts
import { z } from 'zod'

export const clientInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number like +7 900 123-45-67'),
  notes: z.string().trim().max(500).optional(),
})
export type ClientInput = z.infer<typeof clientInput>

export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '')] ??= issue.message
  return out
}
```

Messages are user-facing: write them in the project language, name the fix ("Enter a phone number like …"). Messages the acceptance tests check come from `docs/ui-contract.md`.

## 2. Server function

`.validator(clientInput)` rejects bad input; business rules return errors keyed by field:

```ts
if (taken) return { ok: false as const, errors: { phone: 'A client with this phone already exists' } }
return { ok: true as const, id: row!.id }
```

## 3. Form component

```tsx
export function ClientForm({ initial, submitLabel, onSubmit }: {
  initial?: Partial<ClientInput>
  submitLabel: string
  onSubmit: (values: ClientInput) => Promise<{ ok: true; id: string } | { ok: false; errors: Partial<Record<string, string>> }>
}) {
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = clientInput.safeParse({ ...raw, notes: raw.notes || undefined })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setPending(true)
    setFailed(false)
    try {
      const result = await onSubmit(parsed.data)
      setErrors(result.ok ? {} : result.errors)
    } catch {
      setFailed(true)                                   // network or unexpected server error
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {failed ? <Alert>{text.somethingWentWrong}</Alert> : null}
      <Field label="Name" name="name" defaultValue={initial?.name} error={errors.name} required />
      <Field label="Phone" name="phone" type="tel" defaultValue={initial?.phone} error={errors.phone} required />
      <Button type="submit" disabled={pending}>{submitLabel}</Button>
    </form>
  )
}
```

The page decides what happens on success: navigate to the record with `search: { saved: true }` and show `<Alert kind="success">Client saved</Alert>` (a `role="status"` message tests can find).

## Rules

- `Field` from `#/components/ui` always: a visible `<label>` tied to the input, `aria-invalid` and the error text under it. For `<select>`, `<textarea>`, checkboxes and radio groups, follow the same pattern (label or `<fieldset><legend>`).
- `noValidate` on the form so our messages, not the browser's, appear.
- Disable the submit button while pending; never submit twice.
- Keep the form usable with the keyboard; the submit button is a real `<button type="submit">`.

## Parsing values

FormData gives strings. Convert in the schema:

```ts
z.object({
  seats: z.coerce.number().int().min(1).max(20),
  price: z.coerce.number().min(0).transform((v) => Math.round(v * 100)),   // money → cents
  startsAt: z.coerce.date(),                                                // from <input type="datetime-local">
  status: z.enum(['booked', 'cancelled']),
  sendReminder: z.preprocess((v) => v === 'on', z.boolean()),             // checkbox
})
```

`datetime-local` has no time zone: treat it as the business's local time and say which zone in `docs/architecture.md`.

TanStack Form (`@tanstack/react-form`) is allowed for large dynamic forms (repeating rows); for ordinary forms use the pattern above.
