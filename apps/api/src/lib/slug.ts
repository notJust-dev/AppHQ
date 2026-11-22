/** A URL-safe id from a display name: "Habit Loop: Tracker!" becomes "habit-loop-tracker". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'app'
}

const RESERVED = new Set(['portfolio', 'new'])

/** The slug itself if it is free, otherwise the first of slug-2, slug-3, ... that is. */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  let base = slugify(name)
  // The demo- prefix is reserved for generated demo apps, which are removed in bulk;
  // `portfolio` is the row that holds accounts shared by several apps; `new` is the dashboard's
  // page for adding an app, and what linking an asset to a new app is asked with.
  if (base.startsWith('demo-') || RESERVED.has(base)) base = `app-${base}`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
