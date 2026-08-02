# iCloud Mail Reader (Rust)

This command-line client reads the latest message exposed by the configured
mailbox viewer and extracts unique six-digit login codes.

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

## Tests

```bash
cargo test --all-targets
```

## Web app

The `docs/` directory contains a dependency-free GitHub Pages app. It builds
the mailbox viewer URL entirely in the browser and opens the latest message in
a new tab. The page never stores the token; remembering the email address is
optional.

Live site: <https://beyondcy1013.github.io/icloud-mail-reader/>

The interface uses icons from [Lucide](https://lucide.dev/) under the ISC
license.
