import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { BrandMark, BrandName } from '@/components/Brand'

/**
 * Who runs the hosted AppHQ and where people write to; shown on both legal pages. Spanish law
 * (LSSI) requires a business site to show these; keep them the same as notjust.dev/legal-notice.
 */
export const OPERATOR = 'NOTJUST.DEV, SL'
export const CONTACT_EMAIL = 'support@notjust.dev'
const COMPANY = {
  nif: 'B26785477',
  address: 'C/ Balmes 129bis 4º 2ª, 08008 Barcelona, Spain',
  registry: 'Registro Mercantil de Barcelona, Tomo/I.R.U.S. 1000468212670, Folio 1, Hoja B 652038, Inscripción 1',
}
/** When the legal pages last changed. Update it with any change to their text. */
export const LEGAL_UPDATED = '25 November 2026'

/** Head tags for a legal page: unlike the dashboard, these are meant to be found. */
export function legalMeta(title: string, description: string) {
  return [
    { title: `${title} · AppHQ` },
    { name: 'description', content: description },
    { name: 'robots', content: 'index, follow' },
  ]
}

/** The links every public page ends with. */
export function PublicFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-8 text-sm text-faint">
      <span>© {new Date().getFullYear()} AppHQ</span>
      <Link to="/privacy" className="hover:text-foreground">
        Privacy
      </Link>
      <Link to="/terms" className="hover:text-foreground">
        Terms
      </Link>
      <a href="https://github.com/notJust-dev/AppHQ" className="hover:text-foreground">
        GitHub
      </a>
    </footer>
  )
}

/** A long-form page of text with the brand on top, for the privacy policy and the terms. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <BrandName className="text-lg" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 pt-10 pb-16">
        <h1 className="font-brand text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-8 space-y-4 leading-7 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}

/** The company's legal identification, as a short list. */
export function CompanyDetails() {
  return (
    <ul>
      <li>Company: {OPERATOR}</li>
      <li>NIF: {COMPANY.nif}</li>
      <li>Registered address: {COMPANY.address}</li>
      <li>{COMPANY.registry}</li>
      <li>
        Email: <ContactEmail />
      </li>
    </ul>
  )
}

/** The contact address as a mail link. */
export function ContactEmail() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
}
