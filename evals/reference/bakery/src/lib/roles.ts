// Roles of the app. The architect decides the project's roles (docs/architecture.md); keep this
// list, the seed and the permission checks in src/server/ in step.
export const ROLES = ['owner', 'baker'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as ReadonlyArray<string>).includes(value)
}

export function hasRole(user: { role: string } | null | undefined, ...roles: Array<Role>): boolean {
  return !!user && roles.some((r) => r === user.role)
}

/** The signed-in user as the UI and server functions see it. */
export type CurrentUser = { id: string; email: string; name: string; role: Role }
