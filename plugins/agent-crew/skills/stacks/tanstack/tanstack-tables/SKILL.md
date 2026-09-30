---
name: tanstack-tables
description: List and CRUD screens in the tanstack profile — list pages with search, filters, sorting and pages in the URL, accessible tables, empty states, the list/new/edit route layout, and delete with confirmation limited to the right role. Use when building a list of records or create/edit/delete screens.
user-invocable: false
paths:
  - src/routes/**
---

# Lists and CRUD screens

Small-business data fits in plain tables: filter, sort and page **on the server**, keep the state **in the URL** (shareable, back button works, tests can open it directly).

## Routes

```
src/routes/_app/clients/index.tsx        /clients              list + search
src/routes/_app/clients/new.tsx          /clients/new          create form
src/routes/_app/clients/$clientId.tsx    /clients/:clientId    edit form + delete
```

Server functions in `src/server/clients.ts`: `listClients`, `getClient`, `createClient`, `updateClient`, `deleteClient` (see `tanstack-routes`), each with `requireUser(...)`.

## List page

```tsx
export const Route = createFileRoute('/_app/clients/')({
  validateSearch: z.object({ q: z.string().optional(), page: z.number().int().min(1).optional() }),
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page ?? 1 }),
  loader: ({ deps }) => listClients({ data: deps }),
  component: ClientsPage,
})

function ClientsPage() {
  const { rows, total, pageSize } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const page = search.page ?? 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <section>
      <h1>Clients</h1>
      <form role="search" onSubmit={(e) => {
        e.preventDefault()
        const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
        void navigate({ search: { q: q || undefined, page: undefined } })
      }}>
        <label htmlFor="client-search" className="sr-only">Search clients</label>
        <input id="client-search" name="q" defaultValue={search.q ?? ''} />
        <button type="submit">Search</button>
      </form>
      {rows.length === 0 ? (
        <p role="status">No clients found.</p>
      ) : (
        <table>
          <caption className="sr-only">Clients</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Phone</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link to="/clients/$clientId" params={{ clientId: c.id }}>{c.name}</Link></td>
                <td>{c.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 ? (
        <nav aria-label="Pages">
          {page > 1 ? <Link from={Route.fullPath} search={(s) => ({ ...s, page: page - 1 })}>Previous</Link> : null}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link from={Route.fullPath} search={(s) => ({ ...s, page: page + 1 })}>Next</Link> : null}
        </nav>
      ) : null}
    </section>
  )
}
```

- Filters (status, date range, owner) are more search params, validated by `validateSearch` and passed through `loaderDeps` to the server function, which builds `and(...)` conditions.
- Sorting: a `sort` search param with a fixed set of values (`z.enum(['name', '-createdAt'])`) mapped to columns on the server — never pass a column name from the URL into the query.
- 20–50 rows per page; show totals the owner cares about ("12 clients").
- Every table has `<th scope="col">` headers and a caption (visible or `sr-only`); the record's name is a link to its page.

## Edit page with delete

```tsx
{hasRole(user, 'owner') ? (
  confirming ? (
    <div role="alertdialog" aria-labelledby="delete-title">
      <p id="delete-title">Delete {client.name}? This cannot be undone.</p>
      <Button onClick={async () => { await deleteClient({ data: { id: client.id } }); await router.navigate({ to: '/clients' }) }}>Yes, delete</Button>
      <Button onClick={() => setConfirming(false)}>Cancel</Button>
    </div>
  ) : (
    <Button onClick={() => setConfirming(true)}>Delete client</Button>
  )
) : null}
```

- Deleting needs a confirmation step and the role check on the server (`requireUser('owner')`).
- Records other records depend on (a client with visits) either cannot be deleted (`onDelete: 'restrict'` → show "This client has visits and cannot be deleted") or are archived with a status column — the architect decides which, per entity.
- After create: navigate to the new record with `search: { saved: true }`; after update: `router.invalidate()` and the same success message; after delete: back to the list.

TanStack Table (`@tanstack/react-table`) is allowed for client-side sorting of already-loaded data or column visibility; ordinary lists use the plain table above.
