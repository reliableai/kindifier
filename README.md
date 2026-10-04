# Kindifier — run it yourself

A kinder Gmail interface that runs on **your own computer** and opens in your browser. No Kindifier account, developer-operated backend, or developer API key is needed. Your computer connects directly to Google and your selected AI service.

## Source code shared for independent use

I am sharing experimental source code in this public repository. I am not offering to install, operate or support the software for anyone, and I am not providing a public hosted email or AI service. If you choose to use it, you download, configure and run your own copy, using your own accounts and credentials. Sharing this code creates no commitment from me to maintain it or provide updates.

The code is available under the [MIT License](LICENSE), including its warranty disclaimer and limitation of liability. This is experimental software, provided as is. The author makes no commitment to support, maintenance, security updates or continued availability. Third-party components retain their own licenses. No notice or license removes obligations that applicable law does not allow to be excluded.

You run the application on your own computer using your own Google and AI accounts. You are responsible for choosing what email you are authorized to share with AI providers, their API charges, and reviewing rewritten content before relying on it or sending it. AI may change meaning or omit important information. Start with non-sensitive test messages.

**Verification limits:** the automated tests use fictional email and mocked providers. macOS installation and the first-run screen have been checked. Live Gmail and live OpenAI/OpenRouter use in this local release, and Windows/Linux installation, have not yet been verified.

## Install from this repository

Install **Node.js 24 or later** and Git, then run:

```sh
git clone https://github.com/reliableai/kindifier.git
cd kindifier
npm ci --foreground-scripts
npm run build
npm start
```

Keep the terminal open while using the app. Complete the [first-run Gmail setup](#first-run-gmail-setup) below. No API key or shared Google application is included. If you want to inspect fictional samples first, use the separate demo described below; never enter real credentials into that demo.

## Read before installing

**This software sends email text to an external AI provider.**

- Choose **OpenAI** or **OpenRouter** using your own API key. With OpenRouter, email goes to **OpenRouter and the model provider it routes to**. Their privacy, retention, and account policies apply.
- After you acknowledge the disclosure, the newest **20 inbox messages** are automatically prepared when you open or refresh the inbox. This means AI rewriting, **not sending outgoing emails**. You pay the provider's API charges. You can opt out during setup or pause from the inbox.
- Each rewrite sends at most **5,000 tokens of email input**, including the subject and JSON formatting. The body is cut at a Unicode character boundary, keeping only its beginning. The system instructions, output, and provider accounting overhead are additional tokens; this is not a 5,000-token total billing cap.
- Long emails show **Partial rewrite**. The omitted remainder stays hidden. A partial draft suggestion cannot replace the full draft. AI can change meaning; check consequential facts.
- Attachments are not sent to AI or rendered. Gmail messages over 2 MB including attachments are rejected. Quoted history and signatures within the selected text count toward the cap.
- Keys and the local encryption key stay in your OS credential store. Gmail tokens, prepared text and drafts are encrypted in a local SQLite database. The author receives neither keys nor email. This is not offline AI.
- No automatic retry or fallback to another AI service. Failures keep originals hidden behind **Show original**. Outgoing email always requires recipient/content review and explicit confirmation.

The documented installation command prints this warning; npm can suppress install scripts/output under other flags. Regardless, first-run setup requires an unchecked acknowledgement before saving settings or accessing real mail. Changing providers requires acknowledgement again.

## Optional: install a package built from source

Prerequisites: **Node.js 24 or later**, a desktop browser, and an unlocked OS credential store (macOS Keychain, Windows Credential Manager, or Linux Secret Service such as GNOME Keyring/KWallet). Linux headless installations without Secret Service are unsupported; credentials never fall back to plaintext files.

After building the repository, `npm run package:local` creates `dist/kindifier-local-0.2.0.tgz`. From the folder containing that file, run:

```sh
npm install --global ./kindifier-local-0.2.0.tgz --foreground-scripts
kindifier
```

Kindifier opens your browser automatically. Leave the terminal open while using it; press **Ctrl+C** to stop. Stopping during an outgoing send can leave its outcome uncertain; after restarting, use **Check send status** instead of sending another copy. The application listens on `127.0.0.1` only, on a randomly chosen port. It is not a public web server. No accounts or API calls are needed just to install it or explore fictional samples.

The launch link is single-use and expires after two minutes. Reloading the already-open tab works until Kindifier stops. To open another tab, copy the local address in the same browser session. For another browser or an expired session, restart Kindifier. Do not share your launch link.

### First-run Gmail setup

Each installer uses **their own** Google Cloud application and AI account:

1. Create a Google Cloud project and enable the **Gmail API**.
2. Configure Google Auth Platform for your own use. If External/Testing, add your Gmail address as a test user. The app requests `gmail.modify` for reading, sending, stars and archive; it has no permanent-delete operation.
3. Create an OAuth client with type **Desktop app** and download its JSON. A Web application client from the former hosted version is not compatible. Google supports loopback callbacks with desktop clients; do not register kindifier.com as the local callback.
4. Run `kindifier`. Choose OpenAI or OpenRouter, select a model, enter your own provider key, and select the Google Desktop JSON file. The file is read locally; the app stores its relevant credentials in your OS credential store.
5. Read and acknowledge the disclosure. Automatic preparation defaults to enabled and can be unchecked. Select **Save locally & enable rewrites**, then **Connect Gmail**.
6. Google opens in your browser. Verify the account and permissions before granting access. Returning to Kindifier loads the newest 20 messages; automatic preparation begins only if enabled.

An app in Google's Testing mode can require reconnecting after seven days. Personal-use exceptions and any verification requirements depend on the user's Google setup: [Google personal-use guidance](https://support.google.com/cloud/answer/13464323) and [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app). Distributing a shared Google application registration would require a separate review of Google's requirements; none is bundled here.

Supported models are `gpt-4.1-mini` and `gpt-4o-mini`, directly or through their `openai/` OpenRouter routes. This deliberate allowlist keeps the token cap tied to their known `o200k_base` tokenizer. Other OpenRouter models are not yet supported. OpenRouter requests structured outputs and routes with data collection denied; unavailable compatible routes fail visibly, without switching providers or models. These settings do not guarantee zero retention.

### Data, pause, and uninstall

- **Pause automatic preparation** stops queued work. A request already sent can finish; it cannot be retracted. A manual open can still prepare that message. Refresh skips successfully cached rewrites for seven days; a failed automatic attempt is not retried again in the same tab unless you explicitly choose **Try again**. A new session can try failed items again.
- **Connection** pauses the current tab's queue. Use the inbox pause button first if you want that preference saved. Disconnect can be temporarily blocked while a provider call is finishing.
- **Disconnect** revokes Gmail access and deletes saved mailbox records. If revocation fails, the app preserves records and reports the failure. Reconnect then disconnect, or manage the Google grant yourself before manually deleting local data.
- To replace provider/Google settings, disconnect first and enter credentials again. Keys are never displayed back to the browser after saving. Configuration is not taken from `.env` files, process API keys, or the former hosted app.
- Local data: macOS `~/Library/Application Support/Kindifier`; Windows `%LOCALAPPDATA%/Kindifier`; Linux `$XDG_DATA_HOME/kindifier` (default `~/.local/share/kindifier`). Only one instance may use this folder. After a crash, confirm no Kindifier process is running before removing `running.lock`.
- Uninstall with `npm uninstall --global kindifier-local`. To remove personal data too, first disconnect, stop the app, delete its local data folder and remove the `com.kindifier.local` / `settings` entry using your OS credential manager. Removing that key before the data makes encrypted records unreadable. Removing the key does not revoke provider access: revoke keys/grants at Google/OpenAI/OpenRouter as needed.

Gmail and other mail apps may still show originals in notifications. Disable their previews if Kindifier is your primary reading surface. Rewriting runs while the app/browser is open, not as a background system service. [Privacy details](PRIVACY.md).

## Development and fictional demo

After building, run `npm run dev` for the separate fictional preview at `http://127.0.0.1:5173`.

The existing `uv` project is retained for Python tooling; Python is not required by the application. `npm run dev` is a separate fictional preview and must not be used for real credentials. This repository is for the local application; it does not include any hosted deployment configuration or hosted credentials.

## Verify and package

```sh
npm test
npm run package:local
```

The release tarball is written to `dist/`. `npm-shrinkwrap.json` pins the dependency tree used by installers (keep it synchronized with package-lock.json after dependency changes). The package.json files allowlist includes runtime code, generated browser assets, SQL migrations, and documentation; it excludes `.env`, `.openai`, Git history, local databases and downloaded credentials. It installs through npm and is not a signed native desktop installer. Do not publish a source archive made by zipping your whole working folder.

Tests use fictional providers/mail, including the local HTTP server, cookie/Host/Origin protection, desktop OAuth callback, encryption, token counting, OpenRouter errors, the newest-20 queue and explicit-send safeguards. Passing mocked tests does not establish real provider availability or real email delivery. Validate each supported operating system before advertising it as tested.

## Before sharing changes

Never commit API keys, downloaded Google client files, tokens, email, local databases, `.env` files or credential-store exports. Keep examples fictional. Ignore rules are a safeguard, not a secret scanner; inspect staged changes and scan the full Git history before publishing.
