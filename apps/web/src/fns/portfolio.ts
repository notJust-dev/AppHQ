import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { api } from '../server/api'
import { requireSession } from './auth'

export const getOverviewFn = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(z.object({ from: z.iso.date(), to: z.iso.date() }))
  .handler(({ data }) => api().overview.get.query(data))
