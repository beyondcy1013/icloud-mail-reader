use std::error::Error;
use std::io::Read;
use std::time::Duration;

use clap::{Parser, ValueEnum};
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::{CACHE_CONTROL, CONTENT_TYPE, USER_AGENT};
use scraper::{node::Node, Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

const SERVICE_BASE_URL: &str = "https://mail.334401.xyz/";
const MICROSOFT_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_URL: &str = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Default, ValueEnum)]
enum Provider {
    #[default]
    Icloud,
    Outlook,
}

#[derive(Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Mail provider to read.
    #[arg(long, value_enum, default_value_t = Provider::Icloud)]
    provider: Provider,

    /// Mailbox viewer access token.
    #[arg(long, env = "ICLOUD_MAIL_TOKEN", hide_env_values = true)]
    token: Option<String>,

    /// iCloud mailbox address associated with the token.
    #[arg(long, env = "ICLOUD_MAIL_EMAIL", hide_env_values = true)]
    email: String,

    /// Outlook OAuth refresh token.
    #[arg(long, env = "OUTLOOK_MAIL_REFRESH_TOKEN", hide_env_values = true)]
    refresh_token: Option<String>,

    /// Microsoft public-client application ID associated with the refresh token.
    #[arg(long, env = "OUTLOOK_MAIL_CLIENT_ID", hide_env_values = true)]
    client_id: Option<String>,

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

#[derive(Debug, Deserialize)]
struct MicrosoftTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct MicrosoftErrorResponse {
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphMessagesResponse {
    value: Vec<GraphMessage>,
}

#[derive(Debug, Deserialize)]
struct GraphMessage {
    subject: Option<String>,
    #[serde(rename = "bodyPreview")]
    body_preview: Option<String>,
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

    let codes = extract_codes(&visible_text)?;

    Ok(MailSummary {
        title,
        codes,
        html_bytes: html.len(),
    })
}

fn extract_codes(text: &str) -> Result<Vec<String>, Box<dyn Error>> {
    let code_regex = Regex::new(r"[0-9]{6}")?;
    let mut codes = Vec::new();
    for matched in code_regex.find_iter(text) {
        let before_is_digit = text[..matched.start()]
            .chars()
            .next_back()
            .is_some_and(|character| character.is_ascii_digit());
        let after_is_digit = text[matched.end()..]
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

    Ok(codes)
}

fn fetch_outlook_summary(
    client: &Client,
    refresh_token: &str,
    client_id: &str,
) -> Result<MailSummary, Box<dyn Error>> {
    if refresh_token.trim().is_empty() {
        return Err("Outlook refresh token must not be empty".into());
    }
    if client_id.trim().is_empty() {
        return Err("Outlook client ID must not be empty".into());
    }

    let token_response = client
        .post(MICROSOFT_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", "https://graph.microsoft.com/.default"),
        ])
        .send()
        .map_err(|_| "Microsoft token request failed")?;
    if !token_response.status().is_success() {
        let status = token_response.status();
        let error_code = token_response
            .json::<MicrosoftErrorResponse>()
            .ok()
            .and_then(|response| response.error)
            .unwrap_or_else(|| "unknown_error".to_owned());
        return Err(format!("Microsoft token request failed ({status}, {error_code})").into());
    }
    let access_token = token_response
        .json::<MicrosoftTokenResponse>()
        .map_err(|_| "Microsoft token response was invalid")?
        .access_token;

    let mut graph_url = Url::parse(MICROSOFT_GRAPH_URL)?;
    graph_url
        .query_pairs_mut()
        .append_pair("$top", "1")
        .append_pair("$orderby", "receivedDateTime desc")
        .append_pair("$select", "subject,bodyPreview");
    let graph_response = client
        .get(graph_url)
        .bearer_auth(access_token)
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .map_err(|_| "Microsoft Graph request failed")?
        .error_for_status()
        .map_err(|_| "Microsoft Graph rejected the mail request; verify Mail.Read permission")?
        .json::<GraphMessagesResponse>()
        .map_err(|_| "Microsoft Graph response was invalid")?;
    summarize_graph_messages(graph_response)
}

fn summarize_graph_messages(
    graph_response: GraphMessagesResponse,
) -> Result<MailSummary, Box<dyn Error>> {
    let message = graph_response
        .value
        .into_iter()
        .next()
        .ok_or("Outlook inbox is empty")?;
    let title = message.subject.unwrap_or_default();
    let preview = message.body_preview.unwrap_or_default();
    let searchable = format!("{title} {preview}");

    Ok(MailSummary {
        title,
        codes: extract_codes(&searchable)?,
        html_bytes: preview.len(),
    })
}

fn run(args: Args) -> Result<(), Box<dyn Error>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(args.timeout))
        .build()?;
    let summary = match args.provider {
        Provider::Icloud => {
            let token = args.token.as_deref().ok_or("iCloud token is required")?;
            let url = build_message_url(token, &args.email)?;
            parse_message(&fetch_message(&client, url)?)?
        }
        Provider::Outlook => fetch_outlook_summary(
            &client,
            args.refresh_token
                .as_deref()
                .ok_or("Outlook refresh token is required")?,
            args.client_id
                .as_deref()
                .ok_or("Outlook client ID is required")?,
        )?,
    };

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

    #[test]
    fn extracts_codes_with_digit_boundaries() {
        let codes = extract_codes("code 123456, duplicate 123456, not 91234567").unwrap();

        assert_eq!(codes, vec!["123456"]);
    }

    #[test]
    fn summarizes_latest_graph_message() {
        let graph_response: GraphMessagesResponse = serde_json::from_str(
            r#"{
                "value": [{
                    "subject": "Your sign-in code is 481209",
                    "bodyPreview": "Use 481209 to finish signing in."
                }]
            }"#,
        )
        .unwrap();

        let summary = summarize_graph_messages(graph_response).unwrap();

        assert_eq!(summary.title, "Your sign-in code is 481209");
        assert_eq!(summary.codes, vec!["481209"]);
        assert_eq!(summary.html_bytes, 32);
    }
}
