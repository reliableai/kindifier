# Kindifier

> [!WARNING]
> **Personal experiment, not a product. Use entirely at your own risk.**
> This is source code from a personal experiment. It is not released, supported or intended for distribution as a product to end users. There is no warranty, no support and no promise of fixes or updates. If you run it, you alone are responsible for the consequences. It reads your email, the local app sends email text to a third-party AI provider, and AI can change meaning or leave out important information. Check anything consequential against the original, and start with non-sensitive test messages. See [Source code shared for independent use](#source-code-shared-for-independent-use).

**Read your email in a kinder tone.** Kindifier rewrites incoming Gmail messages so they read calm and respectful while keeping every fact, date, request and refusal. The original is always one click away.

It comes in two forms, both running on **your own computer**. Neither needs a Kindifier account, a developer-run server or a developer API key.

| | **Local app** | **Chrome extension** (prototype) |
|---|---|---|
| What it is | A Gmail interface that opens in your browser | A side panel that rewrites messages inside Gmail |
| Who rewrites the email | OpenAI or OpenRouter, using **your** API key | Chrome's built-in Gemini Nano, **on your computer** |
| Does email text leave your computer? | **Yes**, it goes to the AI provider you choose | No |
| Setup | Node.js, your own Google Cloud OAuth client, an AI API key | Desktop Chrome 138+, a one-time model download (about 4 GB) |
| Features | Inbox, newest-20 auto-preparation, kinder drafts, replies, confirmed sending | Rewrites each message you open. Reading only. |
| Cost | Your provider's API charges | Free |

---

## Source code shared for independent use

I am sharing experimental source code in this public repository. I am not offering to install, operate or support the software for anyone, and I am not providing a public hosted email or AI service. If you choose to use it, you download, configure and run your own copy, using your own accounts and credentials. Sharing this code creates no commitment from me to maintain it or provide updates.

The code is available under the [Apache License 2.0](LICENSE), including its disclaimer of warranty and limitation of liability. The author makes no commitment to support, maintenance, security updates or continued availability. Third-party components retain their own licenses. No notice or license removes obligations that applicable law does not allow to be excluded.

You run the software on your own computer using your own Google and AI accounts. You are responsible for choosing what email you are authorized to share with AI providers, for their API charges, and for reviewing rewritten content before relying on it or sending it.

**Verification limits:** automated tests use fictional email, mocked providers and, for the extension, a fake model and a minimal fake page. macOS installation and the local app's first-run screen have been checked. Live Gmail and live OpenAI/OpenRouter use in the local app, and Windows/Linux installation, have not yet been verified. The extension depends on Gmail's page structure, which automated tests do not cover and which Gmail can change at any time.

---

## Local app

### Quick start

Install **Node.js 24 or later** and Git, then run:

```sh
git clone https://github.com/reliableai/kindifier.git
cd kindifier
npm ci --foreground-scripts
npm run build
npm start
```

Your browser opens automatically. Keep the terminal open while you use the app, and press **Ctrl+C** to stop. Then complete the [first-run Gmail setup](#first-run-gmail-setup). No API key or shared Google application is included.

To look around with fictional samples first, use the [demo](#fictional-demo). Never enter real credentials into the demo.

### Read before installing

**The local app sends email text to an external AI provider.**

- **Provider.** You choose **OpenAI** or **OpenRouter** and use your own API key. With OpenRouter, email goes to **OpenRouter and the model provider it routes to**. Their privacy, retention and account policies apply.
- **Automatic preparation.** After you acknowledge the disclosure, the newest **20 inbox messages** are prepared automatically when you open or refresh the inbox. "Prepared" means AI rewriting. It **does not send any outgoing email**. You pay the provider's API charges. You can opt out during setup or pause from the inbox.
- **Size cap.** Each rewrite sends at most **5,000 tokens of email input**, including the subject and JSON formatting. The body is cut at a Unicode character boundary, keeping only its beginning. System instructions, output and provider accounting overhead are additional tokens, so this is not a 5,000-token billing cap.
- **Long emails** show **Partial rewrite**, and the omitted remainder stays hidden. A partial draft suggestion cannot replace the full draft.
- **Attachments** are not sent to AI or rendered. Gmail messages over 2 MB including attachments are rejected. Quoted history and signatures within the selected text count toward the cap.
- **Storage.** Keys and the local encryption key stay in your OS credential store. Gmail tokens, prepared text and drafts are encrypted in a local SQLite database. The author receives neither keys nor email. This is not offline AI.
- **Failures.** There is no automatic retry or fallback to another AI service. When rewriting fails, the original stays hidden behind **Show original**. Outgoing email always requires recipient and content review and explicit confirmation.

The documented install command prints this warning. npm can suppress install scripts and output under other flags, so first-run setup also requires an unchecked acknowledgement before saving settings or accessing real mail. Changing providers requires acknowledgement again.

### Requirements

- **Node.js 24 or later** and a desktop browser.
- An unlocked OS credential store: macOS Keychain, Windows Credential Manager, or a Linux Secret Service such as GNOME Keyring or KWallet. Headless Linux without Secret Service is unsupported. Credentials never fall back to plaintext files.

### First-run Gmail setup

Each person who installs Kindifier uses **their own** Google Cloud application and AI account:

1. Create a Google Cloud project and enable the **Gmail API**.
2. Configure Google Auth Platform for your own use. If it is External/Testing, add your Gmail address as a test user. The app requests `gmail.modify` for reading, sending, stars and archive. It has no permanent-delete operation.
3. Create an OAuth client of type **Desktop app** and download its JSON. A Web application client from the former hosted version is not compatible. Google supports loopback callbacks for desktop clients, so do not register kindifier.com as the local callback.
4. Run `npm start` (or `kindifier` if you [installed the package](#optional-install-a-packaged-build)). Choose OpenAI or OpenRouter, select a model, enter your provider key and select the Google Desktop JSON file. The file is read locally, and the app stores its relevant credentials in your OS credential store.
5. Read and acknowledge the disclosure. Automatic preparation is on by default and can be unchecked. Select **Save locally & enable rewrites**, then **Connect Gmail**.
6. Google opens in your browser. Check the account and permissions before granting access. Back in Kindifier, the newest 20 messages load, and automatic preparation starts only if you enabled it.

An app in Google's Testing mode may need reconnecting after seven days. Personal-use exceptions and verification requirements depend on your Google setup; see [Google personal-use guidance](https://support.google.com/cloud/answer/13464323) and [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app). Distributing a shared Google application registration would require a separate review of Google's requirements. None is bundled here.

### Supported models

`gpt-4.1-mini` and `gpt-4o-mini`, directly or through their `openai/` OpenRouter routes. This deliberate allowlist keeps the token cap tied to their known `o200k_base` tokenizer. Other OpenRouter models are not yet supported.

OpenRouter requests use structured outputs and routes with data collection denied. When no compatible route is available, the request fails visibly, without switching providers or models. These settings do not guarantee zero retention.

### Using the app safely

- **Local only.** The app listens on `127.0.0.1` on a randomly chosen port. It is not a public web server.
- **Launch link.** The link is single-use and expires after two minutes. Reloading the open tab works until Kindifier stops. To open another tab, copy the local address in the same browser session. For another browser or an expired session, restart Kindifier. Do not share your launch link.
- **Stopping mid-send.** Stopping during an outgoing send can leave its outcome uncertain. After restarting, use **Check send status** instead of sending another copy.
- **Other mail apps.** Gmail and other mail apps may still show originals in notifications. Turn off their previews if Kindifier is your main reading surface.
- **Not a background service.** Rewriting runs only while the app and browser are open.

### Pause, disconnect and data

- **Pause automatic preparation** stops queued work. A request already sent can finish but cannot be retracted. Opening a message manually can still prepare it. Refresh skips successfully cached rewrites for seven days. A failed automatic attempt is not retried in the same tab unless you choose **Try again**; a new session can try failed items again.
- **Connection** pauses the current tab's queue. Use the inbox pause button first if you want that preference saved. Disconnect can be briefly blocked while a provider call is finishing.
- **Disconnect** revokes Gmail access and deletes saved mailbox records. If revocation fails, the app keeps the records and reports the failure. Reconnect and disconnect again, or manage the Google grant yourself before deleting local data manually.
- **Changing settings.** To replace provider or Google settings, disconnect first and enter credentials again. Keys are never shown back to the browser after saving. Configuration is not read from `.env` files, process API keys or the former hosted app.
- **Local data folder:** macOS `~/Library/Application Support/Kindifier`; Windows `%LOCALAPPDATA%/Kindifier`; Linux `$XDG_DATA_HOME/kindifier` (default `~/.local/share/kindifier`). Only one instance may use this folder. After a crash, confirm no Kindifier process is running before removing `running.lock`.

See [PRIVACY.md](PRIVACY.md) for the full data flow.

### Optional: install a packaged build

After building the repository, `npm run package:local` creates `dist/kindifier-local-0.2.0.tgz`. From the folder containing that file:

```sh
npm install --global ./kindifier-local-0.2.0.tgz --foreground-scripts
kindifier
```

It installs through npm and is not a signed native desktop installer.

**Uninstall** with `npm uninstall --global kindifier-local`. To remove personal data too: disconnect, stop the app, delete the local data folder, then remove the `com.kindifier.local` / `settings` entry in your OS credential manager. Removing that key before the data makes the encrypted records unreadable. Removing it does not revoke provider access, so revoke keys and grants at Google, OpenAI or OpenRouter as needed.

---

## Chrome extension (on-device prototype)

The extension rewrites each Gmail message you open using **Gemini Nano, the model built into Chrome**. Email text is processed on your computer and is not sent to any server. No Google Cloud project, API key or Node.js is needed.

### Requirements

- **Desktop Chrome 138 or later**, which provides the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api).
- Hardware that can run Gemini Nano. The panel tells you if yours can't. Roughly: 22 GB of free disk, plus a GPU with more than 4 GB of memory or 16 GB of RAM.
- A one-time model download of about 4 GB.

### Install

1. Get the code (`git clone https://github.com/reliableai/kindifier.git`, or download the ZIP from GitHub).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository's `extension/` folder.
4. Click the Kindifier icon in the Chrome toolbar to open the side panel. If it shows **Download Gemini Nano**, click it and wait for the download to finish.
5. Reload Gmail once.

### How it works

- When you open a message, its body and subject are hidden right away. A **Kinder version** box appears in their place while the side panel rewrites the message.
- **Show original** / **Hide original** toggles the original at any time.
- Every message gets a fresh model session, so earlier emails never leak into later rewrites. Output must match a strict JSON schema; an incomplete or unreadable result is shown as an error, never as a partial rewrite.
- The prompt follows the same rules as the local app: keep all facts, dates, amounts, requests and refusals; don't invent apologies or agreements; describe abuse calmly instead of quoting it.
- The side panel shows a log of recent rewrites and how long each took.

### Limits

- **Keep the side panel open.** The model runs in the panel. If it's closed, opened messages stay hidden with a prompt to open it; then click **Try again**.
- **Reading only.** There are no drafts, replies or sending.
- **Only opened messages are rewritten.** The inbox list and Gmail's notifications still show original subjects and snippets.
- **Languages:** English, Spanish, German, French and Japanese.
- Very long emails can exceed the on-device model's limit and show an error. Images and attachments are not rewritten.
- It finds messages using Gmail's current page structure, so a Gmail redesign can break it.

### Privacy

The extension asks only for the `sidePanel` permission and runs only on `mail.google.com`. It has no network code: messages pass from the Gmail tab to the side panel and to Chrome's built-in model, all inside your browser. It stores nothing, apart from the model Chrome downloads. To remove it, delete it from `chrome://extensions`.

---

## Development

```sh
npm test               # builds, then runs all tests (local app + extension)
npm run dev            # fictional demo at http://127.0.0.1:5173
npm run package:local  # writes the release tarball to dist/
```

### Fictional demo

`npm run dev` (after `npm run build`) serves a separate preview with fictional sample email at `http://127.0.0.1:5173`. It must not be used with real credentials.

### Tests

Tests use fictional providers and mail. For the local app they cover the local HTTP server, cookie/Host/Origin protection, the desktop OAuth callback, encryption, token counting, OpenRouter errors, the newest-20 queue and explicit-send safeguards. For the extension they cover the on-device rewrite (with a fake model) and the Gmail content script (with a minimal fake page).

Passing mocked tests does not establish real provider availability, real email delivery or compatibility with today's Gmail. Validate each supported operating system before advertising it as tested.

### Repository layout

```
local/       local app: CLI, local HTTP server, settings, SQLite database, disclosure
server/      request handling, Gmail, AI rewriting, encryption, demo
public/      browser UI of the local app
extension/   Chrome extension (on-device Gemini Nano)
drizzle/     SQL migrations
scripts/     build and fictional demo server
tests/       automated tests
```

### Packaging

`npm-shrinkwrap.json` pins the dependency tree used by installers; keep it in sync with `package-lock.json` after dependency changes. The `files` allowlist in `package.json` includes runtime code, generated browser assets, SQL migrations and documentation. It excludes `.env`, `.openai`, Git history, local databases, downloaded credentials and the Chrome extension. Do not publish a source archive made by zipping your whole working folder.

The existing `uv` project is kept for Python tooling. Python is not required by the application. This repository contains no hosted deployment configuration or hosted credentials.

### Before sharing changes

Never commit API keys, downloaded Google client files, tokens, email, local databases, `.env` files or credential-store exports. Keep examples fictional. Ignore rules are a safeguard, not a secret scanner, so inspect staged changes and scan the full Git history before publishing.

## License

Licensed under the [Apache License 2.0](LICENSE). If you redistribute Kindifier or a modified version, you must include the [NOTICE](NOTICE) file crediting the original author, as section 4 of the license requires. Modified files must say that you changed them.
