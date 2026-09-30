// User-facing text of the template screens. Translate it to the project language (and set
// `lang` and `appName`) in the first frontend task; the e2e tests read their labels from here.
export const text = {
  lang: 'en',
  appName: 'Business App',
  homeIntro: 'Sign in to manage your business.',
  signIn: 'Sign in',
  signOut: 'Sign out',
  email: 'Email',
  password: 'Password',
  wrongCredentials: 'Wrong email or password',
  dashboard: 'Dashboard',
  signedInAs: (name: string) => `Signed in as ${name}`,
  notFound: 'Page not found',
  backHome: 'Back to the start page',
  somethingWentWrong: 'Something went wrong. Try again.',
}
