import { createServerFn } from '@tanstack/react-start'
import { errorReportingConfig } from '@/server/errors'

/** Public: a DSN is meant to be seen by browsers. Null when error reporting is off. */
export const getErrorReportingConfigFn = createServerFn({ method: 'GET' }).handler(async () => errorReportingConfig())
