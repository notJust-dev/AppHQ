/** The subset of a logger that connectors and the sync runner need. Fastify's logger fits it. */
export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/** Plain stdout/stderr logger for CLI runs, where output lands in Velocity's cron logs. */
export const consoleLogger: Logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
}
