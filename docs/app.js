"use strict";

const ICLOUD_SERVICE_BASE = "https://mail.334401.xyz/show/";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";
const PROFILE_STORAGE_KEY = "mail-reader:profiles:v2";
const LEGACY_PROFILE_STORAGE_KEY = "icloud-mail-reader:profiles:v1";
const LEGACY_MAILBOX_KEY = "icloud-mail-reader:mailbox";
const MAX_PROFILES = 50;
const ICLOUD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const APPLE_MAILBOX_PATTERN = /^[^\s@]+@(icloud\.com|me\.com|mac\.com)$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_TOKEN_PATTERN = /^\S{40,4096}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const form = document.querySelector("#reader-form");
const mailboxLabel = document.querySelector("#mailbox-label");
const mailboxInput = document.querySelector("#mailbox-address");
const accessLabel = document.querySelector("#access-label");
const accessInput = document.querySelector("#viewer-access");
const clientIdField = document.querySelector("#client-id-field");
const clientIdInput = document.querySelector("#client-id");
const showAccess = document.querySelector("#show-access");
const rememberMailbox = document.querySelector("#remember-mailbox");
const emailError = document.querySelector("#email-error");
const tokenError = document.querySelector("#token-error");
const clientIdError = document.querySelector("#client-id-error");
const tokenNote = document.querySelector("#token-note");
const formStatus = document.querySelector("#form-status");
const submitButton = form.querySelector(".primary-action");
const submitLabel = document.querySelector("#submit-label");
const savedAccounts = document.querySelector("#saved-accounts");
const savedCount = document.querySelector("#saved-count");
const switchAccount = document.querySelector("#switch-account");
const deleteAccount = document.querySelector("#delete-account");
const clearAccounts = document.querySelector("#clear-accounts");
const messageResult = document.querySelector("#message-result");
const messageTitle = document.querySelector("#message-title");
const messageDate = document.querySelector("#message-date");
const messageSender = document.querySelector("#message-sender");
const messageCodes = document.querySelector("#message-codes");
const messagePreview = document.querySelector("#message-preview");

let profiles = readProfiles();
let lastDetectedProvider = null;

function detectProvider(mailbox) {
  if (!EMAIL_PATTERN.test(mailbox)) {
    return null;
  }
  return APPLE_MAILBOX_PATTERN.test(mailbox) ? "icloud" : "outlook";
}

function profileKey(profile) {
  return `${profile.provider}:${profile.email.toLowerCase()}`;
}

function isValidProfile(profile) {
  if (
    !profile ||
    !["icloud", "outlook"].includes(profile.provider) ||
    typeof profile.email !== "string" ||
    typeof profile.access !== "string" ||
    !Number.isFinite(profile.updatedAt)
  ) {
    return false;
  }
  if (profile.provider === "icloud") {
    return APPLE_MAILBOX_PATTERN.test(profile.email) && ICLOUD_TOKEN_PATTERN.test(profile.access);
  }
  return (
    EMAIL_PATTERN.test(profile.email) &&
    REFRESH_TOKEN_PATTERN.test(profile.access) &&
    typeof profile.clientId === "string" &&
    CLIENT_ID_PATTERN.test(profile.clientId)
  );
}

function readProfiles() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) || "[]");
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.filter(isValidProfile).slice(0, MAX_PROFILES);
    }
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) || "[]");
    if (!Array.isArray(legacy)) {
      return [];
    }
    return legacy
      .map((profile) => ({ ...profile, provider: "icloud", clientId: "" }))
      .filter(isValidProfile)
      .slice(0, MAX_PROFILES);
  } catch {
    return [];
  }
}

function writeProfiles() {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
    window.localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_MAILBOX_KEY);
    return true;
  } catch {
    formStatus.textContent = "浏览器未允许本地存储，账户没有保存。";
    return false;
  }
}

function renderProfiles(selectedKey = "") {
  const previousSelection = selectedKey || savedAccounts.dataset.selectedKey || "";
  savedAccounts.replaceChildren();

  if (profiles.length === 0) {
    const emptyOption = document.createElement("div");
    emptyOption.className = "saved-option";
    emptyOption.setAttribute("role", "option");
    emptyOption.setAttribute("aria-disabled", "true");
    emptyOption.textContent = "暂无保存账户";
    savedAccounts.append(emptyOption);
    savedAccounts.dataset.selectedKey = "";
    savedAccounts.removeAttribute("aria-activedescendant");
  } else {
    const selectedProfile = profiles.find((profile) => profileKey(profile) === previousSelection) || profiles[0];
    profiles.forEach((profile, index) => {
      const key = profileKey(profile);
      const option = document.createElement("div");
      const provider = document.createElement("span");
      const address = document.createElement("span");
      option.id = `saved-option-${index}`;
      option.className = "saved-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(key === profileKey(selectedProfile)));
      option.dataset.key = key;
      provider.className = `provider-badge ${profile.provider}`;
      provider.textContent = profile.provider === "icloud" ? "iCloud" : "Outlook";
      address.className = "saved-email";
      address.textContent = profile.email;
      option.append(provider, address);
      savedAccounts.append(option);
    });
    savedAccounts.dataset.selectedKey = profileKey(selectedProfile);
    const selectedOption = savedAccounts.querySelector('[aria-selected="true"]');
    savedAccounts.setAttribute("aria-activedescendant", selectedOption.id);
  }

  savedCount.textContent = String(profiles.length);
  updateSavedActions();
}

function selectedProfile() {
  return profiles.find((profile) => profileKey(profile) === savedAccounts.dataset.selectedKey) || null;
}

function selectProfile(key) {
  if (!profiles.some((profile) => profileKey(profile) === key)) {
    return;
  }
  savedAccounts.dataset.selectedKey = key;
  for (const option of savedAccounts.querySelectorAll(".saved-option[data-key]")) {
    option.setAttribute("aria-selected", String(option.dataset.key === key));
  }
  const selectedOption = savedAccounts.querySelector('[aria-selected="true"]');
  savedAccounts.setAttribute("aria-activedescendant", selectedOption.id);
  selectedOption.scrollIntoView({ block: "nearest" });
  updateSavedActions();
}

function updateSavedActions() {
  const hasSelection = Boolean(selectedProfile());
  switchAccount.disabled = !hasSelection;
  deleteAccount.disabled = !hasSelection;
  clearAccounts.disabled = profiles.length === 0;
}

function renderProvider(provider) {
  if (!provider) {
    mailboxLabel.textContent = "邮箱地址";
    mailboxInput.placeholder = "name@icloud.com 或 name@outlook.com";
    accessLabel.textContent = "邮箱凭据";
    accessInput.placeholder = "输入 Token";
    tokenNote.textContent = "输入邮箱后会自动识别类型；保存后仅写入当前浏览器。";
    clientIdField.hidden = true;
    clientIdInput.required = false;
    submitLabel.textContent = "读取最新邮件";
    messageResult.hidden = true;
    return;
  }

  const isOutlook = provider === "outlook";
  mailboxLabel.textContent = isOutlook ? "Outlook 邮箱" : "iCloud 邮箱";
  mailboxInput.placeholder = isOutlook ? "name@outlook.com" : "name+alias@icloud.com";
  accessLabel.textContent = isOutlook ? "Refresh Token" : "访问 Token";
  accessInput.placeholder = isOutlook ? "输入 OAuth Refresh Token" : "输入访问 Token";
  tokenNote.textContent = isOutlook
    ? "仅发送到微软官方登录端点；保存后会写入当前浏览器。"
    : "保存后会写入当前浏览器，仅限可信设备使用。";
  clientIdField.hidden = !isOutlook;
  clientIdInput.required = isOutlook;
  submitLabel.textContent = isOutlook ? "读取最新邮件" : "打开最新邮件";
  messageResult.hidden = true;
}

function updateProviderFromMailbox(clearCredentialsOnChange = false) {
  const provider = detectProvider(mailboxInput.value.trim());
  if (
    clearCredentialsOnChange &&
    provider &&
    lastDetectedProvider &&
    provider !== lastDetectedProvider
  ) {
    accessInput.value = "";
    clientIdInput.value = "";
  }
  if (provider) {
    lastDetectedProvider = provider;
  }
  renderProvider(provider);
  return provider;
}

function loadSelectedProfile() {
  const profile = selectedProfile();
  if (!profile) {
    return;
  }
  mailboxInput.value = profile.email;
  lastDetectedProvider = profile.provider;
  renderProvider(profile.provider);
  accessInput.value = profile.access;
  clientIdInput.value = profile.clientId || "";
  accessInput.type = "password";
  showAccess.checked = false;
  rememberMailbox.checked = true;
  formStatus.textContent = `已切换到 ${profile.email}`;
}

function upsertProfile(profile) {
  const previousProfiles = profiles;
  const key = profileKey(profile);
  profiles = [
    { ...profile, updatedAt: Date.now() },
    ...profiles.filter((item) => profileKey(item) !== key),
  ].slice(0, MAX_PROFILES);
  if (!writeProfiles()) {
    profiles = previousProfiles;
    return false;
  }
  renderProfiles(key);
  return true;
}

function removeSelectedProfile() {
  const profile = selectedProfile();
  if (!profile || !window.confirm(`删除已保存账户 ${profile.email}？`)) {
    return;
  }
  const previousProfiles = profiles;
  profiles = profiles.filter((item) => profileKey(item) !== profileKey(profile));
  if (!writeProfiles()) {
    profiles = previousProfiles;
    return;
  }
  if (mailboxInput.value.trim().toLowerCase() === profile.email.toLowerCase()) {
    mailboxInput.value = "";
    accessInput.value = "";
    clientIdInput.value = "";
    lastDetectedProvider = null;
    renderProvider(null);
  }
  renderProfiles();
  formStatus.textContent = "已删除所选账户。";
  savedAccounts.focus();
}

function clearAllProfiles() {
  if (profiles.length === 0 || !window.confirm(`清空全部 ${profiles.length} 个已保存账户？`)) {
    return;
  }
  const previousProfiles = profiles;
  profiles = [];
  if (!writeProfiles()) {
    profiles = previousProfiles;
    return;
  }
  mailboxInput.value = "";
  accessInput.value = "";
  clientIdInput.value = "";
  lastDetectedProvider = null;
  renderProvider(null);
  renderProfiles();
  formStatus.textContent = "已清空全部保存记录。";
  mailboxInput.focus();
}

function setFieldError(input, output, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  output.textContent = message;
}

function clearErrors() {
  setFieldError(mailboxInput, emailError, "");
  setFieldError(accessInput, tokenError, "");
  setFieldError(clientIdInput, clientIdError, "");
}

function validateInputs(provider, mailbox, access, clientId) {
  const errors = { mailbox: "", access: "", clientId: "" };
  if (!mailbox) {
    errors.mailbox = "请输入邮箱地址。";
  } else if (!provider) {
    errors.mailbox = "请输入有效的邮箱地址。";
  }
  if (!access) {
    errors.access = provider === "outlook" ? "请输入 Refresh Token。" : "请输入访问 Token。";
  } else if (provider === "icloud" && !ICLOUD_TOKEN_PATTERN.test(access)) {
    errors.access = "Token 应为 20-256 位字母、数字、下划线或连字符。";
  } else if (provider === "outlook" && !REFRESH_TOKEN_PATTERN.test(access)) {
    errors.access = "Refresh Token 格式无效。";
  }
  if (provider === "outlook" && !CLIENT_ID_PATTERN.test(clientId)) {
    errors.clientId = "请输入有效的 Microsoft Client ID。";
  }
  return errors;
}

function extractCodes(text) {
  const codes = [];
  for (const match of text.matchAll(/(^|\D)(\d{6})(?!\d)/g)) {
    if (!codes.includes(match[2])) {
      codes.push(match[2]);
    }
  }
  return codes;
}

function displayOutlookMessage(message) {
  const subject = message.subject || "（无主题）";
  const preview = message.bodyPreview || "";
  const sender = message.from?.emailAddress;
  const codes = extractCodes(`${subject} ${preview}`);
  messageTitle.textContent = subject;
  messageDate.textContent = message.receivedDateTime
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(message.receivedDateTime),
      )
    : "";
  messageDate.dateTime = message.receivedDateTime || "";
  messageSender.textContent = sender
    ? `来自 ${sender.name || sender.address || "未知发件人"}${sender.name && sender.address ? ` <${sender.address}>` : ""}`
    : "来自未知发件人";
  messageCodes.replaceChildren();
  for (const code of codes) {
    const codeElement = document.createElement("code");
    codeElement.textContent = code;
    messageCodes.append(codeElement);
  }
  messagePreview.textContent = preview || "邮件没有可显示的文本摘要。";
  messageResult.hidden = false;
}

function microsoftError(status, payload, phase) {
  const code = typeof payload?.error === "string" ? payload.error : "unknown_error";
  if (phase === "token") {
    return `Microsoft 授权失败（${status} / ${code}），请检查 Refresh Token 与 Client ID 是否配对且仍有效。`;
  }
  if (status === 403) {
    return "Microsoft Graph 拒绝读取邮件，请确认该授权包含 Mail.Read 权限。";
  }
  return `Microsoft Graph 读取失败（${status} / ${code}）。`;
}

async function readOutlook(mailbox, refreshToken, clientId) {
  const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://graph.microsoft.com/.default",
    }),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
    throw new Error(microsoftError(tokenResponse.status, tokenPayload, "token"));
  }

  const rotatedRefreshToken =
    typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token : refreshToken;
  accessInput.value = rotatedRefreshToken;
  if (rememberMailbox.checked) {
    upsertProfile({
      provider: "outlook",
      email: mailbox,
      access: rotatedRefreshToken,
      clientId,
    });
  }

  const graphUrl = new URL(MICROSOFT_GRAPH_URL);
  graphUrl.searchParams.set("$top", "1");
  graphUrl.searchParams.set("$orderby", "receivedDateTime desc");
  graphUrl.searchParams.set("$select", "subject,bodyPreview,from,receivedDateTime");
  const graphResponse = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const graphPayload = await graphResponse.json().catch(() => ({}));
  if (!graphResponse.ok) {
    throw new Error(microsoftError(graphResponse.status, graphPayload, "graph"));
  }
  const message = Array.isArray(graphPayload.value) ? graphPayload.value[0] : null;
  if (!message) {
    throw new Error("Outlook 收件箱目前没有邮件。");
  }
  displayOutlookMessage(message);
}

function migrateLegacyMailbox() {
  try {
    const legacyMailbox = window.localStorage.getItem(LEGACY_MAILBOX_KEY) || "";
    if (profiles.length === 0 && APPLE_MAILBOX_PATTERN.test(legacyMailbox)) {
      mailboxInput.value = legacyMailbox;
    }
    if (profiles.length > 0 && !window.localStorage.getItem(PROFILE_STORAGE_KEY)) {
      writeProfiles();
    }
  } catch {
    // The form remains usable when storage is unavailable.
  }
}

renderProfiles();
migrateLegacyMailbox();
updateProviderFromMailbox();
showAccess.addEventListener("change", () => {
  accessInput.type = showAccess.checked ? "text" : "password";
});
mailboxInput.addEventListener("input", () => {
  setFieldError(mailboxInput, emailError, "");
  updateProviderFromMailbox(true);
});
accessInput.addEventListener("input", () => setFieldError(accessInput, tokenError, ""));
clientIdInput.addEventListener("input", () => setFieldError(clientIdInput, clientIdError, ""));

savedAccounts.addEventListener("click", (event) => {
  const option = event.target.closest(".saved-option[data-key]");
  if (option) {
    selectProfile(option.dataset.key);
  }
});
savedAccounts.addEventListener("dblclick", (event) => {
  const option = event.target.closest(".saved-option[data-key]");
  if (option) {
    selectProfile(option.dataset.key);
    loadSelectedProfile();
  }
});
savedAccounts.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadSelectedProfile();
    return;
  }
  const currentIndex = Math.max(
    0,
    profiles.findIndex((profile) => profileKey(profile) === savedAccounts.dataset.selectedKey),
  );
  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") {
    nextIndex = Math.min(profiles.length - 1, currentIndex + 1);
  } else if (event.key === "ArrowUp") {
    nextIndex = Math.max(0, currentIndex - 1);
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = profiles.length - 1;
  } else {
    return;
  }
  if (profiles[nextIndex]) {
    event.preventDefault();
    selectProfile(profileKey(profiles[nextIndex]));
  }
});

switchAccount.addEventListener("click", loadSelectedProfile);
deleteAccount.addEventListener("click", removeSelectedProfile);
clearAccounts.addEventListener("click", clearAllProfiles);

window.addEventListener("storage", (event) => {
  if ([PROFILE_STORAGE_KEY, LEGACY_PROFILE_STORAGE_KEY, null].includes(event.key)) {
    profiles = readProfiles();
    renderProfiles();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";
  messageResult.hidden = true;

  const mailbox = mailboxInput.value.trim();
  const provider = detectProvider(mailbox);
  const access = accessInput.value.trim();
  const clientId = clientIdInput.value.trim();
  const errors = validateInputs(provider, mailbox, access, clientId);
  setFieldError(mailboxInput, emailError, errors.mailbox);
  setFieldError(accessInput, tokenError, errors.access);
  setFieldError(clientIdInput, clientIdError, errors.clientId);
  if (errors.mailbox || errors.access || errors.clientId) {
    (errors.mailbox ? mailboxInput : errors.access ? accessInput : clientIdInput).focus();
    return;
  }

  if (provider === "icloud") {
    const saved = rememberMailbox.checked
      ? upsertProfile({ provider, email: mailbox, access, clientId: "" })
      : false;
    const destination = `${ICLOUD_SERVICE_BASE}${encodeURIComponent(access)}/${encodeURIComponent(mailbox)}`;
    accessInput.value = "";
    accessInput.type = "password";
    showAccess.checked = false;
    formStatus.textContent = saved
      ? "账户已保存，正在新标签页打开最新邮件。"
      : "正在新标签页打开最新邮件。";
    const link = document.createElement("a");
    link.href = destination;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  formStatus.textContent = "正在通过 Microsoft Graph 读取最新邮件…";
  try {
    await readOutlook(mailbox, access, clientId);
    formStatus.textContent = rememberMailbox.checked
      ? "读取成功，账户凭据已更新并保存在当前浏览器。"
      : "读取成功。";
  } catch (error) {
    formStatus.textContent = error instanceof Error ? error.message : "Outlook 邮件读取失败。";
  } finally {
    accessInput.value = "";
    accessInput.type = "password";
    showAccess.checked = false;
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
});
