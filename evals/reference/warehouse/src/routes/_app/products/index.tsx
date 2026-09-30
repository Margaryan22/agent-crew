import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { hasRole } from '#/lib/roles'
import { listProducts } from '#/server/stock'

export const Route = createFileRoute('/_app/products/')({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => listProducts({ data: deps }),
  component: ProductsPage,
})

function ProductsPage() {
  const rows = Route.useLoaderData()
  const search = Route.useSearch()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1>Products</h1>
        {hasRole(user, 'owner') ? (
          <Link to="/products/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
            New product
          </Link>
        ) : null}
      </div>
      <form
        role="search"
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault()
          const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
          void navigate({ search: { q: q || undefined } })
        }}
      >
        <label htmlFor="product-search" className="mb-1 block text-sm font-medium">
          Search products
        </label>
        <input id="product-search" name="q" defaultValue={search.q ?? ''} className="rounded-md border px-3 py-2" />
      </form>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">SKU</th>
            <th scope="col">In stock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to="/products/$productId" params={{ productId: p.id }} className="underline">
                  {p.name}
                </Link>
              </td>
              <td>{p.sku}</td>
              <td>
                {p.stock} {p.low ? <span className="ml-2 rounded bg-amber-100 px-2 text-amber-900">Low stock</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
