import { Link, createFileRoute } from '@tanstack/react-router'
import { listLowStock } from '#/server/stock'

export const Route = createFileRoute('/_app/low-stock')({
  loader: () => listLowStock(),
  component: LowStockPage,
})

function LowStockPage() {
  const rows = Route.useLoaderData()
  return (
    <section>
      <h1>Low stock</h1>
      {rows.length === 0 ? (
        <p role="status">Nothing is low.</p>
      ) : (
        <ul>
          {rows.map((p) => (
            <li key={p.id}>
              <Link to="/products/$productId" params={{ productId: p.id }}>
                {p.name}
              </Link>{' '}
              — {p.stock} of minimum {p.minStock}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
