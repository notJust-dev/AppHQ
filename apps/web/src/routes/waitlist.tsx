import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The landing page used to live here; it is now what signed-out visitors see at `/`. The route
 * stays (Velocity keeps deleted route files) and sends old links home.
 */
export const Route = createFileRoute('/waitlist')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true })
  },
})
