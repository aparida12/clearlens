import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/api/articles(.*)',
  '/api/generate(.*)',
  '/api/subscribe(.*)',
  '/api/unsubscribe(.*)',
  '/api/email/digest(.*)',
  '/api/admin/nuke(.*)',
  '/api/poll(.*)',
  '/api/agent/articles(.*)',
  '/api/agent/run(.*)',
  '/api/agent/debug(.*)',
  '/story(.*)',
  '/about(.*)',
  '/legal(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)'
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)']
}
