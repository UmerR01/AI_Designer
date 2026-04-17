# Django Auth + Email Verification + Long Sessions (Designer)

This document describes the **full plan** and the exact pieces to implement a production-ready login system using **Django** (API) + **Next.js** (UI).

## Goals

- **Email + password** sign up and sign in
- **Email verification required** before the user can sign in
- **Very long login session** so users don’t have to sign in again frequently
- **Toast notifications** for success/error states in the UI (top-right, professional dark style)

## UX (user perspective)

### Sign up

1. User opens **Create account**.
2. Enters email + password (and name fields).
3. App shows toast: **“Check your inbox to verify your email.”**
4. User receives a **branded verification email** with a single **Verify email** button.

### Verify email

1. User clicks verification link.
2. App shows toast: **“Email verified. You can sign in now.”**
3. User is taken to **Sign in**.

### Sign in

1. User opens **Sign in**, enters email + password.
2. On success: toast **“Welcome back.”** and redirect to app (e.g. `/` or `/dashboard`).

### Long session behavior

- After sign-in, the browser receives a **secure, httpOnly session cookie** from Django.
- The session is configured to be **long-lived** (e.g. 180 days).
- While the user remains active, the session can be extended (“sliding sessions”).

## Architecture

- **Frontend:** Next.js (this repo)
- **Backend:** Django + DRF in `backend/`
- **Auth method:** Django **session cookie** authentication
  - Next.js calls Django endpoints with `credentials: "include"`
  - POST requests include CSRF token header (`X-CSRFToken`)

> Why sessions (cookies) instead of JWT?
> - Cookie sessions are the simplest, safest default for browser apps when combined with CSRF protection.

## Backend (Django) design

### Data model

Use a custom user model (recommended when starting fresh):

- `email` (unique, used for login)
- `first_name`, `last_name`
- `is_active` (can remain `True`; verification is separate)
- `email_verified` (boolean)
- `date_joined`

Passwords are stored using Django’s built-in password hashing.

### Endpoints (minimal)

All endpoints are under `/api/auth/`:

- `GET /api/auth/csrf/`
  - ensures CSRF cookie is set (used by browser before POST)
- `POST /api/auth/signup/`
  - body: `{ email, password, first_name, last_name }`
  - creates user as `email_verified=false`
  - sends verification email
  - returns `201` with `{ ok: true }`
- `GET /api/auth/verify-email/?token=...`
  - validates token, sets `email_verified=true`
  - redirects to Next.js: `/login?verified=1`
- `POST /api/auth/resend-verification/`
  - body: `{ email }`
  - if user exists and not verified, resend verification email
  - returns `200` with `{ ok: true }`
- `POST /api/auth/login/`
  - body: `{ email, password }`
  - rejects if `email_verified=false`
  - on success uses Django `login()` to create a session
  - returns `200` with `{ user: { id, email, first_name, last_name } }`
- `POST /api/auth/logout/`
  - clears session
  - returns `200` with `{ ok: true }`
- `GET /api/auth/me/`
  - returns current user if session is valid
  - returns `401` if not authenticated

### Email verification token

- Use **Django signing** to generate a tamper-proof token containing:
  - user id
  - email
  - timestamp
- Token expiration: e.g. **24 hours**

### Email template (current implementation)

- **Multipart email**: HTML + plain-text fallback
- Templates:
  - `backend/accounts/templates/emails/verify_email.html` (branded; button-only, no long link displayed)
  - `backend/accounts/templates/emails/verify_email.txt` (fallback includes the link)
- Sender:
  - Implemented in `backend/accounts/emails.py` using `EmailMultiAlternatives`

### Long session settings

Recommended values (prod):

- `SESSION_COOKIE_AGE = 60 * 60 * 24 * 180` (180 days)
- `SESSION_SAVE_EVERY_REQUEST = True` (sliding expiration)
- `SESSION_EXPIRE_AT_BROWSER_CLOSE = False`
- `SESSION_COOKIE_HTTPONLY = True`
- `SESSION_COOKIE_SECURE = True` (HTTPS only)
- `CSRF_COOKIE_SECURE = True`
- `CSRF_COOKIE_HTTPONLY = False` (must be readable by JS to send header)
- `CSRF_TRUSTED_ORIGINS = ["https://<your-next-domain>"]`
- `CORS_ALLOWED_ORIGINS = ["https://<your-next-domain>"]`
- `CORS_ALLOW_CREDENTIALS = True`

Local dev:

- `SESSION_COOKIE_SECURE = False`
- `CSRF_COOKIE_SECURE = False`
- `CSRF_TRUSTED_ORIGINS = ["http://localhost:3000"]`
- `CORS_ALLOWED_ORIGINS = ["http://localhost:3000"]`

### Security

- Rate limit:
  - `login`
  - `resend-verification`
- Invalidate sessions on password change (Django does this behaviorally; also recommended: rotate session)

## Frontend (Next.js) plan

### API client (browser)

- `lib/auth-api.ts`
  - `ensureCsrfCookie()`: calls `GET /api/auth/csrf/`
  - `postJson(path, body)`: includes:
    - `credentials: "include"`
    - `X-CSRFToken` from cookie
    - `Content-Type: application/json`

`NEXT_PUBLIC_DJANGO_API_BASE_URL` will be used, e.g. `http://localhost:8000`.

### Form wiring

Update existing views:

- `components/auth/signup-form.tsx`
  - On submit:
    - `await getCsrf()`
    - `POST /api/auth/signup/`
    - toast success
    - navigate to `/login` with a hint (or show “check inbox” state)
- `components/auth/login-form.tsx`
  - On submit:
    - `await getCsrf()`
    - `POST /api/auth/login/`
    - toast success
    - redirect to `/`
  - If error indicates “not verified”:
    - toast error + show “Resend verification” action

### Toasts

Use **Sonner** (already installed).

- Add `<Toaster />` once in `app/layout.tsx`
- Use `toast.success()` / `toast.error()` in forms
- On `/login?verified=1`, show a toast on mount: “Email verified…”

#### Toast design (current implementation)

- Location: **top-right**
- Style: **professional dark** (ink/black), subtle border, pink accent actions
- Files:
  - `components/ui/sonner.tsx` (theme variables + classNames)
  - `app/layout.tsx` (`position="top-right"`)

### Session checks

- `GET /api/auth/me/` to determine if user is authenticated
- Use for:
  - changing nav state (Sign in vs Sign out)
  - protecting any future `/dashboard` pages

## Implementation checklist

Backend:

- Create Django project in `backend/`
- Add dependencies: DRF, cors headers
- Implement custom user + migrations
- Implement endpoints
- Configure session + CSRF + CORS
- Email sending:
  - Dev (current): Gmail SMTP via `backend/.env` (auto-loaded by `python-dotenv`)
  - Prod: SMTP provider (Resend/Mailgun/SendGrid) or Gmail if acceptable

Frontend:

- Add Sonner `<Toaster />`
- Add auth API helper
- Wire login/signup to backend
- Add verify success toast via query param
- Add resend verification UI (small link/button)

## Local development commands (target)

Backend:

python -m venv .venv
cd backend
.venv/scripts/activate
pip install -r backend/requirements.txt
python manage.py migrate
python manage.py runserver 8000

cd "c:\Users\ESHOP\Downloads\AI-GraphicDesigner"
backend\.venv\Scripts\python.exe backend\manage.py runserver 8000

Frontend:

npm install
npm run dev

## Reusable concise checklist (copy/paste)

### Backend (Django)

- Configure `backend/.env`:
  - `DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`
  - `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_USE_TLS=1`
  - `EMAIL_HOST_USER=<gmail>`, `EMAIL_HOST_PASSWORD=<gmail app password>`
  - `DEFAULT_FROM_EMAIL=Designer <gmail>`
- Run:
  - `backend\.venv\Scripts\python.exe backend\manage.py migrate`
  - `backend\.venv\Scripts\python.exe backend\manage.py runserver 8000`
- Verify endpoints:
  - `GET /api/auth/csrf/`
  - `POST /api/auth/signup/` (sends verification email)
  - `GET /api/auth/verify-email/?token=...` (redirects to `/login?verified=1`)
  - `POST /api/auth/login/` (blocked until verified)
  - `POST /api/auth/resend-verification/`

### Frontend (Next.js)

- Set `NEXT_PUBLIC_DJANGO_API_BASE_URL=http://localhost:8000`
- Run `npm run dev`
- Confirm toasts + redirects:
  - signup success toast
  - verify success toast on `/login?verified=1`
  - resend verification toast

