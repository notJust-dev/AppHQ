/*
 * shadcn/ui's table lives in table-primitives.tsx; import it from here, as `@/components/ui/table`.
 * Velocity's deploys keep files the repository deleted, and an older table.ts at this path would
 * win over a table.tsx, since .ts resolves first. Keeping this file makes the path mean the same
 * thing there and here.
 */
export * from './table-primitives'
