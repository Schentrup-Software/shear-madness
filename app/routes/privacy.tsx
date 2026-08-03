// Contact address published on the privacy policy. Google's OAuth verification
// requires a working contact for the app; change this if a different mailbox
// should receive privacy requests.
const CONTACT_EMAIL = 'joey@schentrupsoftware.com';

const LAST_UPDATED = 'August 3, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">{title}</h2>
      <div className="space-y-3 text-gray-700 dark:text-gray-200 leading-relaxed">{children}</div>
    </section>
  );
}

export function meta() {
  return [
    { title: 'Privacy Policy — Shear Madness' },
    {
      name: 'description',
      content: 'How Shear Madness handles the information you provide when running or joining a Cornhole tournament.',
    },
  ];
}

export default function Privacy() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Privacy Policy</h1>
      <p className="mb-8 text-sm text-gray-700 dark:text-gray-300">Last updated: {LAST_UPDATED}</p>

      <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6 md:p-8">
        <Section title="The short version">
          <p>
            Shear Madness is a tool for running Cornhole tournaments. It asks for as little as
            possible: a display name, and — only if you want turn notifications — an email address.
            There are no accounts to create, no advertising, no analytics, and no tracking across
            other sites. Nothing collected here is sold or shared for marketing.
          </p>
        </Section>

        <Section title="Who is responsible for your information">
          <p>
            Shear Madness is open-source software that anyone can host. Each deployment is run
            independently, and whoever operates the copy you are using — normally the person
            organizing your tournament — is responsible for the data it holds. This policy describes
            how the software behaves; it does not change any obligations your organizer has.
          </p>
        </Section>

        <Section title="What the app collects">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-semibold">Your display name.</span> Whatever you type when you
              sign up. It is shown to the organizer and to other players in the bracket, so use only
              a name you're comfortable sharing.
            </li>
            <li>
              <span className="font-semibold">Your Google Chat email — optional.</span> Provided only
              if you choose to receive a message when your match starts. Leave it blank and no
              notifications are sent. It is visible to the organizer and to other players in the same
              tournament.
            </li>
            <li>
              <span className="font-semibold">Tournament and match data.</span> Tournament name,
              number of boards, team pairings, match status, and results.
            </li>
            <li>
              <span className="font-semibold">An anonymous session identity.</span> The app
              automatically creates a throwaway account so it can tell participants apart. It uses a
              randomly generated internal address such as{' '}
              <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">
                temp_a1b2c3@temp.local
              </code>{' '}
              and a random password. It is not a real mailbox, is never emailed, and is not linked to
              your identity.
            </li>
            <li>
              <span className="font-semibold">Notification delivery records.</span> If Chat
              notifications are in use, the app records whether each message succeeded, failed, or was
              skipped — including the player name and email it was addressed to — so the organizer can
              tell whether people were actually reached.
            </li>
            <li>
              <span className="font-semibold">Organizer Google credentials.</span> If an organizer
              connects Google Chat, the authorization tokens Google issues are stored on the server.
              They are never sent to any browser and are not shared with anyone.
            </li>
          </ul>
        </Section>

        <Section title="What the app does not collect">
          <ul className="list-disc pl-5 space-y-2">
            <li>No advertising or analytics trackers, and no cookies used for tracking.</li>
            <li>No passwords of yours, and no sign-in with an existing account for players.</li>
            <li>No location data, contacts, photos, or device identifiers.</li>
            <li>
              No access to your Google Chat conversations. The integration can only start a direct
              message and post to it — it cannot read your messages, history, or any other space.
            </li>
          </ul>
        </Section>

        <Section title="The Google Chat integration">
          <p>
            An organizer may connect their own Google account so the app can send players a direct
            message when their match starts. Messages are sent as that organizer.
          </p>
          <p>Connecting requests only these permissions:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-semibold">Create a direct message space</span> — to open a 1:1
              conversation with a player who opted in.
            </li>
            <li>
              <span className="font-semibold">Send a message</span> — to post the "you're up" note.
            </li>
            <li>
              <span className="font-semibold">See the connected account's email address</span> — so
              the dashboard can show which account is connected.
            </li>
          </ul>
          <p>
            None of these grant the ability to read existing conversations. When a notification is
            sent, the player's email address and the message text are transmitted to Google in order
            to deliver it.
          </p>
          <p>
            An organizer can revoke access at any time using <span className="font-semibold">Disconnect</span> on
            the tournament dashboard, which deletes the stored tokens, or from their{' '}
            <a
              className="text-blue-600 dark:text-blue-400 underline"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google account permissions
            </a>
            .
          </p>
          <p>
            Shear Madness's use of information received from Google APIs adheres to the{' '}
            <a
              className="text-blue-600 dark:text-blue-400 underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Data obtained through Google APIs is used only
            to deliver these notifications. It is not sold, not transferred to third parties, not used
            for advertising, and not used to train any generalized machine-learning model. No human
            reads it except where required to resolve a support problem, for security, or to comply
            with the law.
          </p>
        </Section>

        <Section title="Other services the app relies on">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-semibold">Google Chat API</span> — used only when an organizer has
              connected Chat and a player has opted in, as described above.
            </li>
            <li>
              <span className="font-semibold">Google Fonts</span> — pages load a webfont from Google's
              servers, which means Google receives your IP address and browser details as part of that
              request, as with any externally hosted font.
            </li>
          </ul>
        </Section>

        <Section title="Information stored in your browser">
          <p>
            The app saves your anonymous session credentials in your browser's local storage so you
            stay recognized between page loads. This is not a tracking cookie and is not readable by
            other websites. Clearing your browser storage for this site removes it — after which the
            app will treat you as a new visitor.
          </p>
        </Section>

        <Section title="Browser notifications">
          <p>
            The player view may ask permission to show a desktop notification when your match begins.
            These are generated by your own browser, are not delivered through any push service, and
            no data leaves your device. You can decline, and the app continues to work normally.
          </p>
        </Section>

        <Section title="How long information is kept">
          <p>
            Tournament, player, and match records remain until the operator of this deployment deletes
            them. Organizers can remove a player from the dashboard before a tournament starts.
            Disconnecting Google Chat immediately deletes the stored tokens and the cached list of
            conversations.
          </p>
          <p>
            To have your name or email removed, ask your tournament organizer, or use the contact
            below.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The app is intended for organizing tournaments among adults and is not directed at
            children. It asks only for a display name and an optional email address, and no age
            information is collected.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If this policy changes, the "last updated" date above will change with it. Material
            changes to how the Google Chat integration handles information will be reflected here
            before they take effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy, or requests to remove your information, can be sent to{' '}
            <a className="text-blue-600 dark:text-blue-400 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
