import { Link, createFileRoute } from '@tanstack/react-router'
import { CompanyDetails, ContactEmail, LegalPage, OPERATOR, legalMeta } from '@/components/Legal'

/** The terms of use for the hosted AppHQ at apphq.io. Public, outside the login. */
export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: legalMeta('Terms of use', 'The terms for using AppHQ at apphq.io.'),
  }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms cover your use of AppHQ at apphq.io, run by {OPERATOR}. By joining the waitlist or
        using the dashboard, you agree to them. If you don't agree, please don't use the site.
      </p>

      <h2>Who we are</h2>
      <CompanyDetails />

      <h2>AppHQ is in early development</h2>
      <p>
        AppHQ is still being built. Features may change, stop working or be removed, and the waitlist
        doesn't guarantee you access or a price. We'll do our best to keep your data safe and the site
        running, but we can't promise it will always be available or error-free.
      </p>

      <h2>The source code</h2>
      <p>
        AppHQ's source code is public on{' '}
        <a href="https://github.com/notJust-dev/AppHQ">GitHub</a> under the GNU Affero General Public
        License v3.0. Your use of the code is governed by that license, not by these terms. The AppHQ
        name and logo aren't covered by the license, and you may not use them for your own hosted
        version or fork.
      </p>

      <h2>Your accounts and data</h2>
      <ul>
        <li>
          Only connect accounts you own or are allowed to use, and follow the terms of each platform you
          connect, such as Apple, Google, Meta, TikTok and RevenueCat.
        </li>
        <li>You're responsible for keeping your dashboard password safe.</li>
        <li>
          Your data stays yours. We use it only as described in the{' '}
          <Link to="/privacy">privacy policy</Link>.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Don't try to break into, overload or disrupt the site, access other people's data, or use AppHQ
        for anything illegal. To report a security problem, follow our{' '}
        <a href="https://github.com/notJust-dev/AppHQ/security/policy">security policy</a>. We may
        suspend access to anyone who breaks these terms.
      </p>

      <h2>No warranty</h2>
      <p>
        AppHQ is provided "as is", without warranties of any kind. Numbers in the dashboard come from
        third-party platforms and may be delayed, incomplete or wrong. Check important figures at the
        source before acting on them.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, {OPERATOR} isn't liable for any indirect or consequential loss,
        or for lost profits, revenue or data, arising from your use of AppHQ. Nothing in these terms
        limits liability that can't be limited by law.
      </p>

      <h2>Applicable law</h2>
      <p>
        These terms are governed by the laws of Spain. Any disputes shall be submitted to the courts of
        Barcelona, Spain, except where applicable law provides otherwise, for example where consumer
        law lets you use the courts where you live.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as AppHQ grows. We'll change the date at the top, and for significant
        changes we'll let waitlist members and users know by email.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <ContactEmail />.
      </p>
    </LegalPage>
  )
}
