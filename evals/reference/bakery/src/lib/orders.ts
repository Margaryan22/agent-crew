import { z } from 'zod'

export const STATUS_LABELS = { new: 'New', baking: 'Baking', ready: 'Ready', picked_up: 'Picked up', cancelled: 'Cancelled' } as const
export type OrderStatus = keyof typeof STATUS_LABELS
/** The next status each button moves to. */
export const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  new: { status: 'baking', label: 'Start baking' },
  baking: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'picked_up', label: 'Picked up' },
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export const orderInput = z.object({
  customerName: z.string().trim().min(1, "Enter the customer's name").max(100),
  phone: z.string().trim().max(40),
  pickupDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a pickup date')
    .refine((d) => d >= today(), 'Choose a future pickup date'),
  items: z
    .array(z.object({ productId: z.string().min(1, 'Choose a product'), quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1') }))
    .min(1, 'Add at least one item'),
})
export type OrderInput = z.infer<typeof orderInput>

export function issues(error: z.ZodError): Array<string> {
  return [...new Set(error.issues.map((i) => i.message))]
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
