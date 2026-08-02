# Mail Reader (Rust)

This command-line client reads the latest iCloud or Outlook message and
extracts unique six-digit login codes.

The viewer token is a password for the third-party mailbox service. It is not
an Apple authentication token. The service endpoint is fixed in the binary so
that a mistyped or malicious URL cannot receive the token.

## Usage

Pass secrets through environment variables to keep them out of shell history:

```bash
export ICLOUD_MAIL_TOKEN='viewer-token'
export ICLOUD_MAIL_EMAIL='name+alias@icloud.com'
cargo run --release
```

The default JSON output has this shape:

```json
{"title":"Your temporary login code","codes":["123456"],"html_bytes":9000}
```

To print only the first six-digit code:

```bash
cargo run --release -- --latest-code
```

You may also pass `--token` and `--email` explicitly, but doing so can expose
the values in shell history and process listings.

### Outlook

Outlook mode exchanges an existing OAuth refresh token at Microsoft's official
login endpoint, then reads the latest inbox preview through Microsoft Graph:

```bash
export OUTLOOK_MAIL_REFRESH_TOKEN='<your-refresh-token>'
export OUTLOOK_MAIL_CLIENT_ID='00000000-0000-0000-0000-000000000000'
cargo run --release -- \
  --provider outlook \
  --email name@outlook.com
```

The refresh token must belong to the supplied public-client application and
include Microsoft Graph `Mail.Read` permission. No client secret is accepted
or required. The CLI never prints access or refresh tokens.

## Tests

```bash
cargo test --all-targets
```

## Web app

The `docs/` directory contains a dependency-free GitHub Pages app. iCloud mode
builds the fixed mailbox viewer URL in the browser and opens it in a new tab.
Outlook mode communicates only with Microsoft's official OAuth and Graph
endpoints and renders the latest message preview as text. By default, the page
stores account credentials in browser local storage so saved accounts can be
switched quickly. Individual entries or the entire local history can be
removed from the account list. Use this option only on a trusted device.

The Outlook implementation was checked against the MIT-licensed
[`cubezhao/ai-tools-mng`](https://github.com/cubezhao/ai-tools-mng) Graph flow at
commit `643bb2bd4efd69a1f573d980ebcf87bc9aa53e0b`. This project uses a smaller,
read-only subset and does not include that project's IMAP fallback or account
management features.

Live site: <https://beyondcy1013.github.io/icloud-mail-reader/>

The interface uses icons from [Lucide](https://lucide.dev/) under the ISC
license.
