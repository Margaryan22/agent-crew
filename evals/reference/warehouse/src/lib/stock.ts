import { z } from 'zod'

export const productInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  sku: z.string().trim().min(1, 'Enter a SKU').max(60),
  unit: z.string().trim().min(1, 'Enter a unit').max(20),
  minStock: z.coerce.number().int('Enter a whole number').min(0, 'Cannot be negative'),
})
export type ProductInput = z.infer<typeof productInput>

export const movementInput = z.object({
  productId: z.uuid(),
  kind: z.enum(['receipt', 'shipment']),
  quantity: z.coerce.number().int('Enter a whole number').min(1, 'At least 1'),
  note: z.string().trim().max(200).optional(),
})

export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '')] ??= issue.message
  return out
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}
