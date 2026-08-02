use std::error::Error;
use std::io::Read;
use std::time::Duration;

use clap::Parser;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::{CACHE_CONTROL, CONTENT_TYPE, USER_AGENT};
use scraper::{node::Node, Html, Selector};
use serde::Serialize;
use url::Url;

const SERVICE_BASE_URL: &str = "https://mail.334401.xyz/";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Mailbox viewer access token.
    #[arg(long, env = "ICLOUD_MAIL_TOKEN", hide_env_values = true)]
    token: String,

    /// iCloud mailbox address associated with the token.
    #[arg(long, env = "ICLOUD_MAIL_EMAIL", hide_env_values = true)]
    email: String,

    /// Print only the first six-digit code.
    #[arg(long)]
    latest_code: bool,

    /// HTTP timeout in seconds.
    #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u64).range(1..=120))]
    timeout: u64,
}

#[derive(Debug, PartialEq, Serialize)]
struct MailSummary {
    title: String,
    codes: Vec<String>,
    html_bytes: usize,
}

fn build_message_url(token: &str, email: &str) -> Result<Url, Box<dyn Error>> {
    if token.is_empty() {
        return Err("token must not be empty".into());
    }
    if !email.contains('@') || email.chars().any(char::is_whitespace) {
        return Err("email address is invalid".into());
    }

    let mut url = Url::parse(SERVICE_BASE_URL)?;
    url.path_segments_mut()
        .map_err(|_| "service URL cannot contain path segments")?
        .extend(["show", token, email]);
    Ok(url)
}

fn fetch_message(client: &Client, url: Url) -> Result<String, Box<dyn Error>> {
    let mut response = client
        .get(url)
        .header(USER_AGENT, "icloud-mail-reader/0.1")
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .map_err(|_| "mail service request failed")?
        .error_for_status()
        .map_err(|_| "mail service returned an unsuccessful response")?;

    let is_html = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/html"));
    if !is_html {
        return Err("mail service returned an unexpected content type".into());
    }

    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("mail response exceeds the size limit".into());
    }

    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("mail response exceeds the size limit".into());
    }

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn parse_message(html: &str) -> Result<MailSummary, Box<dyn Error>> {
    let document = Html::parse_document(html);
    let title_selector = Selector::parse("title").map_err(|_| "invalid title selector")?;
    let body_selector = Selector::parse("body").map_err(|_| "invalid body selector")?;

    let title = document
        .select(&title_selector)
        .next()
        .map(|element| element.text().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut visible_text = String::new();
    if let Some(body) = document.select(&body_selector).next() {
        for node in body.descendants() {
            let Node::Text(text) = node.value() else {
                continue;
            };
            let ignored = node.ancestors().any(|ancestor| {
                matches!(
                    ancestor.value(),
                    Node::Element(element) if matches!(element.name(), "script" | "style")
                )
            });
            if !ignored {
                visible_text.push_str(text);
                visible_text.push(' ');
            }
        }
    }

    let code_regex = Regex::new(r"[0-9]{6}")?;
    let mut codes = Vec::new();
    for matched in code_regex.find_iter(&visible_text) {
        let before_is_digit = visible_text[..matched.start()]
            .chars()
            .next_back()
            .is_some_and(|character| character.is_ascii_digit());
        let after_is_digit = visible_text[matched.end()..]
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit());
        if before_is_digit || after_is_digit {
            continue;
        }
        let code = matched.as_str().to_owned();
        if !codes.contains(&code) {
            codes.push(code);
        }
    }

    Ok(MailSummary {
        title,
        codes,
        html_bytes: html.len(),
    })
}

fn run(args: Args) -> Result<(), Box<dyn Error>> {
    let url = build_message_url(&args.token, &args.email)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(args.timeout))
        .build()?;
    let summary = parse_message(&fetch_message(&client, url)?)?;

    if args.latest_code {
        let code = summary.codes.first().ok_or("no six-digit code found")?;
        println!("{code}");
    } else {
        println!("{}", serde_json::to_string(&summary)?);
    }
    Ok(())
}

fn main() {
    if let Err(error) = run(Args::parse()) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_url_with_encoded_email_path_segment() {
        let url = build_message_url("abc_def-123", "name+alias@icloud.com").unwrap();

        assert_eq!(
            url.as_str(),
            "https://mail.334401.xyz/show/abc_def-123/name+alias@icloud.com"
        );
    }

    #[test]
    fn rejects_invalid_email() {
        let error = build_message_url("token", "not-an-email").unwrap_err();

        assert_eq!(error.to_string(), "email address is invalid");
    }

    #[test]
    fn extracts_unique_codes_and_ignores_script_and_style_text() {
        let html = r#"
            <html>
              <head>
                <title>Your &amp; login code</title>
                <style>.code { color: #123456; }</style>
              </head>
              <body>
                <p>Code: <strong>932763</strong></p>
                <p>Again: 932763</p>
                <script>const ignored = 654321;</script>
              </body>
            </html>
        "#;

        let summary = parse_message(html).unwrap();

        assert_eq!(summary.title, "Your & login code");
        assert_eq!(summary.codes, vec!["932763"]);
        assert_eq!(summary.html_bytes, html.len());
    }
}
