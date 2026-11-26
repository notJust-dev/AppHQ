import type { z } from 'zod'
import type { Scope } from '../organizations/scope.js'

/** A query reads one organization's data: the one in the context, never another. */
export type QueryContext = Scope

/**
 * A query is a named function with a Zod input schema. The same definitions back the tRPC
 * router today, and the MCP tools and the Telegram agent later, so the name and description
 * are written for an AI reader as much as for a developer.
 */
export interface QueryDef<Input extends z.ZodType, Output> {
  name: string
  description: string
  input: Input
  handler(ctx: QueryContext, input: z.infer<Input>): Promise<Output>
}

export function defineQuery<Input extends z.ZodType, Output>(
  def: QueryDef<Input, Output>,
): QueryDef<Input, Output> {
  return def
}
