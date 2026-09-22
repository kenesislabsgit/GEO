const recipients = [
  {
    name: "AI providers",
    data: "Buyer questions, selected region/language, and the context needed to generate and analyze answers. Analysis and recommendation steps may also send public website extracts and audit evidence.",
    purpose:
      "Generate answers, compare brands, and write evidence-based recommendations. The supported providers are OpenAI, Anthropic, Google, Perplexity, Mistral, xAI, Amazon Bedrock, DeepSeek, Moonshot AI, Groq, MiniMax, Sarvam and Alibaba Cloud. Which providers receive a request depends on the audit selection and the configured analysis steps.",
  },
  {
    name: "Web retrieval and search",
    data: "Website URLs, search queries about companies, and public page content.",
    purpose:
      "Read your website and verify cited evidence. The engine can use Firecrawl, AWS AgentCore web search and DuckDuckGo, as configured, as well as requesting public pages directly.",
  },
  {
    name: "Dodo Payments",
    data: "Account email, selected plan and interval, and identifiers linking checkout to your account. You provide payment details directly in hosted checkout.",
    purpose:
      "Process subscriptions and refunds. Arcanoris receives payment and subscription status; the app does not collect your full card number.",
  },
  {
    name: "Resend and Zoho Mail (SMTP)",
    data: "Recipient email addresses and message content. Support requests include the contact details and issue description you submit.",
    purpose:
      "Deliver account and monitoring emails through Resend, and route contact inquiries through the configured SMTP service (Zoho by default).",
  },
  {
    name: "Google sign-in (optional)",
    data: "The Google account information you authorize, such as your name and email, plus sign-in identifiers.",
    purpose:
      "Sign you in when you choose Google. Email/password signup is also available; your Google password is not sent to Arcanoris.",
  },
  {
    name: "Hosting, database and abuse prevention",
    data: "Account records, saved audits, operational logs and request metadata. Rate-limit keys can contain an IP address or email address.",
    purpose:
      "Run the website and worker, store your results and limit abuse. Rate limits use Upstash Redis when configured, otherwise the application's PostgreSQL database.",
  },
];

export function DataRecipients() {
  return (
    <section className="mt-10">
      <h2 className="font-heading text-xl font-semibold">
        Who receives data, and why
      </h2>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        An audit sends data to service providers; it is not processed entirely
        in your browser. Private-report settings restrict public access to the
        report, but do not prevent the processing below. Do not put confidential
        or personal information in buyer questions unless you are authorized to
        send it for analysis.
      </p>
      <dl className="mt-5 divide-y divide-border">
        {recipients.map((row) => (
          <div key={row.name} className="py-5">
            <dt className="font-medium">{row.name}</dt>
            <dd className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  Data shared:{" "}
                </span>
                {row.data}
              </p>
              <p>{row.purpose}</p>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Provider retention, processing locations and data-use terms vary by
        service and configuration. Making a report private does not change those
        providers&apos; terms. Public previews can also be accessed by visitors and
        search engines.
      </p>
    </section>
  );
}
