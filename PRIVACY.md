# Kindifier local data flow

Before enabling real mail, the installation warning and setup screen explain and require acknowledgement of external AI processing. There is no analytics, telemetry, developer account, or developer proxy in the local runtime.

Your computer downloads messages from Google's Gmail API. The local application extracts plain text, caps the email input to 5,000 tokens, and sends it directly to the AI service selected in setup. OpenAI receives OpenAI requests; OpenRouter receives OpenRouter requests and forwards them to its serving model provider. The provider receives your credential for authentication, email text for inference, and ordinary connection metadata such as your IP address. Provider retention and processing rules apply. Your use of those services can incur charges.

The first 20 inbox messages are prepared automatically when you load/refresh the inbox if you enabled that option. Pause is available. Requests already transmitted cannot be recalled. Cached successful rewrites can be reused for seven days. Rewriting never sends an outgoing email to its recipient; sending has a separate review/confirm action.

Original subject/body/preview are excluded from ordinary inbox responses. Originals remain behind Show original, including when AI fails. Original HTML and remote images are not rendered. Attachments are not sent to AI. Prepared rewrites may omit the portion beyond the cap, and their visible warning must be considered when reading consequential messages.

Your OS credential store holds the provider API key, Google Desktop client settings and encryption key. The local database holds encrypted Gmail access/refresh tokens, prepared text and drafts. Some metadata (such as account address, message IDs, operation IDs and timestamps) is not encrypted. Local files are restricted to the OS user where supported. The browser holds displayed message content in memory. Malware or someone with access to your unlocked account may still access data; encryption is not a guarantee against a compromised computer.

API credentials are not logged or returned to the browser after setup. Errors record route, type/code and stack frames; they exclude request bodies, email text, authorization values and provider error bodies. No external images or fonts are required by the app. The computer contacts Google for authorization/Gmail and the selected AI endpoint for rewriting. Installation can contact npm to download dependencies; opening links is a user action.

Disconnect revokes the Gmail grant and deletes mailbox records after confirmed revocation. Uninstalling the program alone does not remove the local data or credential-store entry. See README for deletion and revocation steps. The package does not include a shared developer Google registration or AI key.
