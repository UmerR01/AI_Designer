import nodemailer from "nodemailer";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function smtpConfig() {
  const host = getEnv("EMAIL_HOST");
  const port = Number(getEnv("EMAIL_PORT"));
  const user = getEnv("EMAIL_HOST_USER");
  const pass = getEnv("EMAIL_HOST_PASSWORD").replace(/\s+/g, "");
  const useTls = String(process.env.EMAIL_USE_TLS ?? "true").toLowerCase() === "true";

  return {
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: { user, pass },
    ...(useTls ? { requireTLS: true } : {}),
  };
}

/** From line in the inbox: "Designer <smtp-user@...>" unless DEFAULT_FROM_EMAIL is set (full override). */
function defaultMailFrom(): string {
  const override = process.env.DEFAULT_FROM_EMAIL?.trim();
  if (override) return override;
  return `Designer <${getEnv("EMAIL_HOST_USER")}>`;
}

export async function sendInviteEmail(args: {
  toEmail: string;
  fromEmail?: string;
  inviterEmail: string;
  projectName: string;
  inviteUrl: string;
  access: "viewer" | "editor";
}) {
  const from = args.fromEmail ?? defaultMailFrom();
  const transporter = nodemailer.createTransport(smtpConfig());

  const accessText = args.access === "editor" ? "can edit" : "can view";
  const preheader = `Open your invite to join “${args.projectName}”.`;

  await transporter.sendMail({
    from,
    to: args.toEmail,
    subject: `Designer invite: ${args.projectName}`,
    text: [
      `${args.inviterEmail} invited you to "${args.projectName}" (${accessText}).`,
      ``,
      `Open invite: ${args.inviteUrl}`,
      ``,
      `If you weren't expecting this, you can ignore this email.`,
    ].join("\n"),
    html: `
      <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
        ${escapeHtml(preheader)}
      </div>
      <div style="background:#0b0b10; padding:32px 12px;">
        <div style="max-width:640px; margin:0 auto; border-radius:28px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); background:rgba(17,17,24,0.86);">
          <div style="padding:26px 26px 18px 26px; background:
            radial-gradient(800px 240px at 0% 0%, rgba(236,168,214,0.22), transparent 60%),
            radial-gradient(600px 220px at 95% 20%, rgba(160,120,255,0.10), transparent 55%);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:14px; height:14px; border-radius:999px; background:#eca8d6; box-shadow:0 10px 30px rgba(236,168,214,0.35);"></div>
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-weight:700; letter-spacing:-0.02em; color:#fff; font-size:18px;">
                Designer
              </div>
            </div>
            <h1 style="margin:16px 0 6px 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:28px; letter-spacing:-0.03em; color:#fff;">
              You’re invited
            </h1>
            <p style="margin:0; color:rgba(255,255,255,0.72); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:14px;">
              Join the project and start designing in minutes.
            </p>
          </div>

          <div style="padding:22px 26px 26px 26px;">
            <div style="border-radius:18px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); padding:14px 14px;">
              <div style="color:rgba(255,255,255,0.65); font-size:12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; letter-spacing:0.12em; text-transform:uppercase;">
                Invitation
              </div>
              <div style="margin-top:8px; color:#fff; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:14px;">
                <strong>${escapeHtml(args.inviterEmail)}</strong> invited you to
                <strong>${escapeHtml(args.projectName)}</strong>
                <span style="color:rgba(255,255,255,0.7);">(${escapeHtml(accessText)})</span>.
              </div>
            </div>

            <div style="margin-top:18px;">
              <a href="${args.inviteUrl}" style="
                display:inline-block;
                padding:12px 18px;
                border-radius:999px;
                background:#eca8d6;
                color:#0b0b10;
                text-decoration:none;
                font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
                font-weight:700;
                letter-spacing:-0.01em;
              ">
                Accept invite
              </a>
            </div>

            <div style="margin-top:22px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.06); color:rgba(255,255,255,0.42); font-size:12px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
              If you weren’t expecting this invite, you can safely ignore this email.
            </div>
          </div>
        </div>
        <div style="max-width:640px; margin:14px auto 0 auto; text-align:center; color:rgba(255,255,255,0.35); font-size:12px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
          © ${new Date().getFullYear()} Designer
        </div>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(args: { toEmail: string; resetUrl: string; fromEmail?: string }) {
  const from = args.fromEmail ?? defaultMailFrom();
  const transporter = nodemailer.createTransport(smtpConfig());
  const preheader = "Reset your Designer password.";

  await transporter.sendMail({
    from,
    to: args.toEmail,
    subject: "Reset your Designer password",
    text: [
      `We received a request to reset your password.`,
      ``,
      `Open this link (valid for 1 hour):`,
      args.resetUrl,
      ``,
      `If you didn’t ask for this, you can ignore this email.`,
    ].join("\n"),
    html: `
      <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
        ${escapeHtml(preheader)}
      </div>
      <div style="background:#0b0b10; padding:32px 12px;">
        <div style="max-width:640px; margin:0 auto; border-radius:28px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); background:rgba(17,17,24,0.86);">
          <div style="padding:26px 26px 18px 26px; background:
            radial-gradient(800px 240px at 0% 0%, rgba(236,168,214,0.22), transparent 60%);">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:14px; height:14px; border-radius:999px; background:#eca8d6;"></div>
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-weight:700; color:#fff; font-size:18px;">Designer</div>
            </div>
            <h1 style="margin:16px 0 6px 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:26px; color:#fff;">Reset your password</h1>
            <p style="margin:0; color:rgba(255,255,255,0.72); font-size:14px;">Tap the button below. This link expires in one hour.</p>
          </div>
          <div style="padding:22px 26px 26px 26px;">
            <a href="${args.resetUrl}" style="
              display:inline-block; padding:12px 18px; border-radius:999px; background:#eca8d6; color:#0b0b10;
              text-decoration:none; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
              font-weight:700;">Choose a new password</a>
            <div style="margin-top:22px; color:rgba(255,255,255,0.42); font-size:12px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
              If you didn’t request this, you can safely ignore this email.
            </div>
          </div>
        </div>
      </div>
    `,
  });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

