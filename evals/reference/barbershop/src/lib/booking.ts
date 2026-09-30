import { z } from 'zod'

export const OPENING_TIMES = Array.from({ length: 16 }, (_, i) => {
  const minutes = 10 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const bookingInput = z.object({
  barberId: z.string().min(1, 'Choose a barber'),
  serviceId: z.string().min(1, 'Choose a service'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
    .refine((d) => d >= today(), 'Choose a future date'),
  time: z.string().refine((t) => OPENING_TIMES.includes(t), 'Choose a time'),
  clientName: z.string().trim().min(1, 'Enter your name').max(100),
  clientPhone: z.string().trim().min(1, 'Enter your phone number').max(40),
})
export type BookingInput = z.infer<typeof bookingInput>

export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '')] ??= issue.message
  return out
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
