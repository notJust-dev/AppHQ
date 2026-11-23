/**
 * The letters "HQ" in Unbounded SemiBold, outlined, so the mark needs no font of its own. The
 * same outline draws public/favicon.svg; change both together.
 */
const HQ =
  'M5.44 20.50L5.44 11.50L7.71 11.50L7.71 14.94L12.59 14.94L12.59 11.50L14.86 11.50L14.86 20.50L12.59 20.50L12.59 16.94L7.71 16.94L7.71 20.50L5.44 20.50M21.26 20.69Q19.67 20.69 18.48 20.10Q17.28 19.52 16.62 18.46Q15.96 17.40 15.96 16Q15.96 14.60 16.62 13.54Q17.28 12.48 18.48 11.90Q19.67 11.31 21.26 11.31Q22.84 11.31 24.03 11.90Q25.23 12.48 25.89 13.54Q26.56 14.60 26.56 16Q26.56 17.40 25.90 18.46Q25.50 19.07 24.95 19.53L26.46 21.16L23.68 21.16L23.06 20.48Q22.23 20.69 21.26 20.69M21.41 18.66L19.82 16.90L22.52 16.90L23.48 17.94Q23.73 17.72 23.91 17.43Q24.27 16.83 24.27 16Q24.27 15.17 23.90 14.57Q23.54 13.97 22.86 13.65Q22.19 13.34 21.26 13.34Q20.33 13.34 19.66 13.65Q18.99 13.97 18.62 14.57Q18.24 15.17 18.24 16Q18.24 16.83 18.62 17.43Q18.99 18.03 19.66 18.35Q20.33 18.66 21.26 18.66Q21.34 18.66 21.41 18.66'

/**
 * The mark: an app tile with "HQ" on it, in the primary colours, so it flips with the theme.
 * It stays neutral, since colour in the dashboard means a funnel stage.
 */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-primary)" />
      <path d={HQ} fill="var(--color-primary-foreground)" />
    </svg>
  )
}

/** The name, set in Geist; the rest of the interface stays in IBM Plex Sans. */
export function BrandName({ className = '' }: { className?: string }) {
  return <span className={`font-brand font-semibold tracking-tight ${className}`}>AppHQ</span>
}
