/** Only same-site paths are allowed after sign-in, so a link can't send users to another site. */
export function safeRedirect(target: string | undefined, fallback = '/dashboard'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback
  return target
}
