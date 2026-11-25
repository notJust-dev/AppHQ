import { createFileRoute } from '@tanstack/react-router'
import { CompanyDetails, ContactEmail, LegalPage, OPERATOR, legalMeta } from '@/components/Legal'

/**
 * The privacy policy. Public, outside the login. Keep it true to what the code does: if a change
 * collects something new or sends data somewhere new, update this page in the same change.
 */
export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: legalMeta('Privacy policy', 'What AppHQ collects, why, and how to have it removed.'),
  }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        AppHQ is run by {OPERATOR}, a company registered in Spain. This page explains what we collect
        on apphq.io, why, and what you can ask us to do with it. For any question or request, email{' '}
        <ContactEmail />.
      </p>

      <h2>Who is responsible for your data</h2>
      <p>The data controller is:</p>
      <CompanyDetails />

      <h2>The waitlist</h2>
      <p>When you join the waitlist we store:</p>
      <ul>
        <li>your email address and the date you signed up,</li>
        <li>where you signed up (for example, the landing page),</li>
        <li>
          any answers you choose to give to the follow-up questions about your apps, such as how many
          apps you run, the tools you use and your rough monthly revenue. Every question is optional.
        </li>
      </ul>
      <p>
        We use this to email you when AppHQ opens and to decide what to build first. We rely on your
        consent, which you give by joining. You can withdraw it at any time by emailing us, and we'll
        delete your entry. Otherwise we keep it until AppHQ opens and you've had the chance to sign up,
        then delete the entries of people who didn't.
      </p>

      <h2>Technical data</h2>
      <p>
        To stop abuse, the site uses your IP address to limit how often you can sign in or join the
        waitlist. It's held in memory for up to an hour and not saved to our database. Our hosting
        provider and Cloudflare, which sits in front of the site, may keep standard request logs,
        including IP addresses, for a short time for security and troubleshooting.
      </p>

      <h2>Cookies</h2>
      <p>
        We don't use analytics or advertising cookies. Signing in to the dashboard sets one session
        cookie, which is needed to keep you signed in. Your light or dark theme choice is kept in your
        own browser and never sent to us.
      </p>

      <h2>Accounts connected to the dashboard</h2>
      <p>
        When you connect an account such as the App Store, Google Play, RevenueCat, TikTok, Instagram,
        Facebook, YouTube or Google Search Console, AppHQ reads the data needed to show it in your
        dashboard: app and store statistics, revenue figures, reviews, posts and their view counts. It
        stores that data and the access credentials in the AppHQ instance's own database, with the
        credentials encrypted.
      </p>
      <ul>
        <li>This data is used only to show your numbers back to you in the dashboard.</li>
        <li>It isn't sold, shared with anyone else, used for advertising or used to train AI models.</li>
        <li>
          AppHQ doesn't send it to an AI service today. If we add a way to ask an AI assistant about
          your numbers, it will be off until you turn it on, and we'll update this page first.
        </li>
        <li>
          You can revoke AppHQ's access at any time from the provider's own settings, for example{' '}
          <a href="https://myaccount.google.com/permissions">your Google account</a>. To have the stored
          credentials and data deleted too, email us.
        </li>
      </ul>
      <p>
        AppHQ's use and transfer of information received from Google APIs follows the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        If you host AppHQ yourself, all of this stays on your own server, and you're responsible for it
        there.
      </p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Cloudways, which hosts the servers and database.</li>
        <li>Cloudflare, which serves the site and protects it from attacks.</li>
        <li>An email delivery provider, once we start emailing the waitlist.</li>
      </ul>
      <p>
        These providers may process data outside your country, including in the United States, under
        their own safeguards for international transfers.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data we hold about you, correct it, delete it or receive a copy of it.
        Email <ContactEmail /> and we'll reply within one month. You can also complain to a data
        protection authority: in Spain, the{' '}
        <a href="https://www.aepd.es">Agencia Española de Protección de Datos</a>, or the authority
        where you live.
      </p>

      <h2>Children</h2>
      <p>AppHQ is for app developers and isn't meant for anyone under 16.</p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we'll update the date at the top. If a change affects how we use data
        you've already given us, we'll email you first.
      </p>
    </LegalPage>
  )
}
