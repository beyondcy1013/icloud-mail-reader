"use strict";

const SERVICE_BASE = "https://mail.334401.xyz/show/";
const PROFILE_STORAGE_KEY = "icloud-mail-reader:profiles:v1";
const LEGACY_MAILBOX_KEY = "icloud-mail-reader:mailbox";
const MAX_PROFILES = 50;
const ACCESS_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const MAILBOX_PATTERN = /^[^\s@]+@icloud\.com$/i;

const form = document.querySelector("#reader-form");
const mailboxInput = document.querySelector("#mailbox-address");
const accessInput = document.querySelector("#viewer-access");
const showAccess = document.querySelector("#show-access");
const rememberMailbox = document.querySelector("#remember-mailbox");
const emailError = document.querySelector("#email-error");
const tokenError = document.querySelector("#token-error");
const formStatus = document.querySelector("#form-status");
const savedAccounts = document.querySelector("#saved-accounts");
const savedCount = document.querySelector("#saved-count");
const switchAccount = document.querySelector("#switch-account");
const deleteAccount = document.querySelector("#delete-account");
const clearAccounts = document.querySelector("#clear-accounts");

let profiles = readProfiles();

function isValidProfile(profile) {
  return (
    profile &&
    typeof profile.email === "string" &&
    MAILBOX_PATTERN.test(profile.email) &&
    typeof profile.access === "string" &&
    ACCESS_PATTERN.test(profile.access) &&
    Number.isFinite(profile.updatedAt)
  );
}

function readProfiles() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidProfile).slice(0, MAX_PROFILES);
  } catch {
    return [];
  }
}

function writeProfiles() {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
    window.localStorage.removeItem(LEGACY_MAILBOX_KEY);
    return true;
  } catch {
    formStatus.textContent = "浏览器未允许本地存储，账户没有保存。";
    return false;
  }
}

function renderProfiles(selectedEmail = "") {
  const previousSelection = selectedEmail || savedAccounts.dataset.selectedEmail || "";
  savedAccounts.replaceChildren();

  if (profiles.length === 0) {
    const emptyOption = document.createElement("div");
    emptyOption.className = "saved-option";
    emptyOption.setAttribute("role", "option");
    emptyOption.setAttribute("aria-disabled", "true");
    emptyOption.textContent = "暂无保存账户";
    savedAccounts.append(emptyOption);
    savedAccounts.dataset.selectedEmail = "";
    savedAccounts.removeAttribute("aria-activedescendant");
  } else {
    const selectedProfileEmail = profiles.some((profile) => profile.email === previousSelection)
      ? previousSelection
      : profiles[0].email;
    profiles.forEach((profile, index) => {
      const option = document.createElement("div");
      option.id = `saved-option-${index}`;
      option.className = "saved-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(profile.email === selectedProfileEmail));
      option.dataset.email = profile.email;
      option.textContent = profile.email;
      savedAccounts.append(option);
    });
    savedAccounts.dataset.selectedEmail = selectedProfileEmail;
    const selectedOption = savedAccounts.querySelector('[aria-selected="true"]');
    savedAccounts.setAttribute("aria-activedescendant", selectedOption.id);
  }

  savedCount.textContent = String(profiles.length);
  updateSavedActions();
}

function selectedProfile() {
  return profiles.find((profile) => profile.email === savedAccounts.dataset.selectedEmail) || null;
}

function selectProfile(email) {
  if (!profiles.some((profile) => profile.email === email)) {
    return;
  }
  savedAccounts.dataset.selectedEmail = email;
  for (const option of savedAccounts.querySelectorAll(".saved-option[data-email]")) {
    option.setAttribute("aria-selected", String(option.dataset.email === email));
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

function loadSelectedProfile() {
  const profile = selectedProfile();
  if (!profile) {
    return;
  }
  mailboxInput.value = profile.email;
  accessInput.value = profile.access;
  accessInput.type = "password";
  showAccess.checked = false;
  rememberMailbox.checked = true;
  setFieldError(mailboxInput, emailError, "");
  setFieldError(accessInput, tokenError, "");
  formStatus.textContent = `已切换到 ${profile.email}`;
}

function upsertProfile(email, access) {
  const previousProfiles = profiles;
  profiles = [
    { email, access, updatedAt: Date.now() },
    ...profiles.filter((profile) => profile.email !== email),
  ].slice(0, MAX_PROFILES);
  const saved = writeProfiles();
  if (!saved) {
    profiles = previousProfiles;
  }
  renderProfiles(email);
  return saved;
}

function removeSelectedProfile() {
  const profile = selectedProfile();
  if (!profile) {
    return;
  }
  if (!window.confirm(`删除已保存账户 ${profile.email}？`)) {
    return;
  }
  const previousProfiles = profiles;
  profiles = profiles.filter((item) => item.email !== profile.email);
  if (!writeProfiles()) {
    profiles = previousProfiles;
    return;
  }
  if (mailboxInput.value.trim() === profile.email) {
    mailboxInput.value = "";
    accessInput.value = "";
  }
  renderProfiles();
  formStatus.textContent = "已删除所选账户。";
  savedAccounts.focus();
}

function clearAllProfiles() {
  if (profiles.length === 0) {
    return;
  }
  if (!window.confirm(`清空全部 ${profiles.length} 个已保存账户？`)) {
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
  renderProfiles();
  formStatus.textContent = "已清空全部保存记录。";
  mailboxInput.focus();
}

function setFieldError(input, output, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  output.textContent = message;
}

function validateMailbox(mailbox) {
  if (!mailbox) {
    return "请输入 iCloud 邮箱。";
  }
  if (!MAILBOX_PATTERN.test(mailbox)) {
    return "请输入以 @icloud.com 结尾的有效邮箱地址。";
  }
  return "";
}

function validateAccess(access) {
  if (!access) {
    return "请输入访问 Token。";
  }
  if (!ACCESS_PATTERN.test(access)) {
    return "Token 应为 20-256 位字母、数字、下划线或连字符。";
  }
  return "";
}

function migrateLegacyMailbox() {
  try {
    const legacyMailbox = window.localStorage.getItem(LEGACY_MAILBOX_KEY) || "";
    if (profiles.length === 0 && MAILBOX_PATTERN.test(legacyMailbox)) {
      mailboxInput.value = legacyMailbox;
    }
  } catch {
    // The form remains usable when storage is unavailable.
  }
}

renderProfiles();
migrateLegacyMailbox();

showAccess.addEventListener("change", () => {
  accessInput.type = showAccess.checked ? "text" : "password";
});

mailboxInput.addEventListener("input", () => {
  setFieldError(mailboxInput, emailError, "");
});

accessInput.addEventListener("input", () => {
  setFieldError(accessInput, tokenError, "");
});

savedAccounts.addEventListener("click", (event) => {
  const option = event.target.closest(".saved-option[data-email]");
  if (option) {
    selectProfile(option.dataset.email);
  }
});
savedAccounts.addEventListener("dblclick", (event) => {
  const option = event.target.closest(".saved-option[data-email]");
  if (option) {
    selectProfile(option.dataset.email);
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
    profiles.findIndex((profile) => profile.email === savedAccounts.dataset.selectedEmail),
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
    selectProfile(profiles[nextIndex].email);
  }
});
switchAccount.addEventListener("click", loadSelectedProfile);
deleteAccount.addEventListener("click", removeSelectedProfile);
clearAccounts.addEventListener("click", clearAllProfiles);

window.addEventListener("storage", (event) => {
  if (event.key === PROFILE_STORAGE_KEY || event.key === null) {
    profiles = readProfiles();
    renderProfiles();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  formStatus.textContent = "";

  const mailbox = mailboxInput.value.trim();
  const access = accessInput.value.trim();
  const mailboxError = validateMailbox(mailbox);
  const accessError = validateAccess(access);

  setFieldError(mailboxInput, emailError, mailboxError);
  setFieldError(accessInput, tokenError, accessError);

  if (mailboxError || accessError) {
    (mailboxError ? mailboxInput : accessInput).focus();
    return;
  }

  const saved = rememberMailbox.checked ? upsertProfile(mailbox, access) : false;
  const destination = `${SERVICE_BASE}${encodeURIComponent(access)}/${encodeURIComponent(mailbox)}`;

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
});
