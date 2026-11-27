/**
 * A refusal that no retry, no other key and no agent action can clear: a PERSON has to act on the platform
 * first — e.g. accept new legal texts in the web app (2026-11-26: GoCertius answered the user-key exchange
 * with 409 RequiredToAcceptNewLegalTexts). It carries the remediation to show the agent verbatim, so the
 * agent tells its user what to do instead of retrying or blaming the credentials.
 */
export class HumanActionRequiredError extends Error {
  constructor(
    message: string,
    readonly remediation: string,
  ) {
    super(message);
    this.name = "HumanActionRequiredError";
  }
}
