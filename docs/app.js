"use strict";

const SERVICE_BASE = "https://mail.334401.xyz/show/";
const STORAGE_KEY = "icloud-mail-reader:mailbox";

const form = document.querySelector("#reader-form");
const mailboxInput = document.querySelector("#mailbox-address");
const accessInput = document.querySelector("#viewer-access");
const showAccess = document.querySelector("#show-access");
const rememberMailbox = document.querySelector("#remember-mailbox");
const emailError = document.querySelector("#email-error");
const tokenError = document.querySelector("#token-error");
const formStatus = document.querySelector("#form-status");

function readRememberedMailbox() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistMailbox(mailbox) {
  try {
    if (rememberMailbox.checked) {
      window.localStorage.setItem(STORAGE_KEY, mailbox);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    formStatus.textContent = "浏览器未允许本地存储，邮箱不会被记住。";
  }
}

function setFieldError(input, output, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  output.textContent = message;
}

function validateMailbox(mailbox) {
  if (!mailbox) {
    return "请输入 iCloud 邮箱。";
  }
  if (!/^[^\s@]+@icloud\.com$/i.test(mailbox)) {
    return "请输入以 @icloud.com 结尾的有效邮箱地址。";
  }
  return "";
}

function validateAccess(access) {
  if (!access) {
    return "请输入访问 Token。";
  }
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(access)) {
    return "Token 应为 20-256 位字母、数字、下划线或连字符。";
  }
  return "";
}

const rememberedMailbox = readRememberedMailbox();
if (rememberedMailbox) {
  mailboxInput.value = rememberedMailbox;
  rememberMailbox.checked = true;
}

showAccess.addEventListener("change", () => {
  accessInput.type = showAccess.checked ? "text" : "password";
});

mailboxInput.addEventListener("input", () => {
  setFieldError(mailboxInput, emailError, "");
});

accessInput.addEventListener("input", () => {
  setFieldError(accessInput, tokenError, "");
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

  persistMailbox(mailbox);
  const destination = `${SERVICE_BASE}${encodeURIComponent(access)}/${encodeURIComponent(mailbox)}`;

  accessInput.value = "";
  accessInput.type = "password";
  showAccess.checked = false;
  formStatus.textContent = "正在新标签页打开最新邮件。";

  const link = document.createElement("a");
  link.href = destination;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
});
