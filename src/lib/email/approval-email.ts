type ApprovalEmailPayload = {
  appUrl: string;
  logoUrl: string;
  recipientEmail: string;
};

type ApprovalEmailContent = {
  html: string;
  subject: string;
  text: string;
};

const FALLBACK_APP_URL = "https://calc.pimseller.ru";
const PRODUCT_NAME = "PIM.Seller";

function appUrl() {
  return normalizeUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || FALLBACK_APP_URL);
}

function normalizeUrl(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildApprovalEmail(payload: ApprovalEmailPayload): ApprovalEmailContent {
  const safeEmail = escapeHtml(payload.recipientEmail);
  const safeAppUrl = escapeHtml(payload.appUrl);
  const safeLogoUrl = escapeHtml(payload.logoUrl);
  const subject = "Доступ к калькулятору PIM.Seller подтверждён";
  const text = [
    "Здравствуйте!",
    "",
    `Ваша регистрация в ${PRODUCT_NAME} подтверждена.`,
    "Теперь вы можете войти в калькулятор юнит-экономики и работать с расчётами.",
    "",
    `Войти: ${payload.appUrl}`,
    "",
    `Аккаунт: ${payload.recipientEmail}`
  ].join("\n");

  const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#eef6f4;color:#17212f;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef6f4;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d8e5e2;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(19,55,48,0.12);">
            <tr>
              <td style="background:#083f38;padding:28px 32px 24px;">
                <img src="${safeLogoUrl}" width="190" alt="PIM.Seller" style="display:block;max-width:190px;height:auto;border:0;background:#ffffff;border-radius:12px;padding:8px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 10px;">
                <div style="display:inline-block;background:#efe8ff;color:#6b2cff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;">Доступ подтверждён</div>
                <h1 style="margin:20px 0 12px;color:#083f38;font-size:30px;line-height:1.16;font-weight:800;">Добро пожаловать в PIM.Seller</h1>
                <p style="margin:0;color:#607083;font-size:17px;line-height:1.55;">Ваша регистрация подтверждена администратором. Теперь можно войти в калькулятор и работать с расчётами для селлеров маркетплейсов.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6fbfa;border:1px solid #dce9e6;border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <div style="color:#708094;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Аккаунт</div>
                      <div style="margin-top:6px;color:#17212f;font-size:18px;font-weight:700;">${safeEmail}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 34px;">
                <a href="${safeAppUrl}" style="display:inline-block;background:#0f8376;color:#ffffff;text-decoration:none;border-radius:12px;padding:15px 22px;font-size:16px;font-weight:800;">Открыть калькулятор</a>
                <p style="margin:22px 0 0;color:#7a8798;font-size:13px;line-height:1.5;">Если кнопка не открывается, скопируйте ссылку в браузер: <br /><a href="${safeAppUrl}" style="color:#0f8376;text-decoration:underline;">${safeAppUrl}</a></p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;color:#8795a6;font-size:12px;line-height:1.4;">Это автоматическое письмо сервиса ${PRODUCT_NAME}. Отвечать на него не нужно.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, subject, text };
}

export async function sendApprovalEmail(recipientEmail: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.APPROVAL_EMAIL_FROM;
  const baseUrl = appUrl();

  if (!apiKey || !from) {
    console.warn("Approval email is not configured. Set RESEND_API_KEY and APPROVAL_EMAIL_FROM.");
    return false;
  }

  const content = buildApprovalEmail({
    appUrl: baseUrl,
    logoUrl: new URL("/pim-seller-logo.png", baseUrl).toString(),
    recipientEmail
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [recipientEmail],
      subject: content.subject,
      html: content.html,
      text: content.text
    })
  });

  if (!response.ok) {
    console.error(`Approval email failed: Resend ${response.status} ${await response.text()}`);
    return false;
  }

  return true;
}
