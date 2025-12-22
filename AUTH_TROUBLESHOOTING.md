# Authentication Troubleshooting Guide

If password reset and magic link emails are not being sent, check the following Supabase configuration:

## 1. Whitelist Redirect URLs in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Under **Redirect URLs**, add these URLs (replace with your actual domain):
   - `http://localhost:3000/auth/callback` - For magic link logins
   - `http://localhost:3000/auth/reset-callback` ⚠️ **REQUIRED** - For password reset
   - `https://yourdomain.com/auth/callback` (for production)
   - `https://yourdomain.com/auth/reset-callback` (for production)
   
   **Note:** Password reset uses a separate callback endpoint (`/auth/reset-callback`) so it can be distinguished from regular logins.

## 2. Configure Site URL

1. In Supabase dashboard, go to **Authentication** → **URL Configuration**
2. Set **Site URL** to your application's base URL:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com`

## 3. Configure Email Service

Supabase needs an email service to send emails. You have two options:

### Option A: Use Supabase's Built-in Email (Limited)
- Supabase provides limited email sending (for development)
- Check **Authentication** → **Email Templates** to ensure templates are enabled
- Note: Free tier has rate limits

### Option B: Configure Custom SMTP (Recommended for Production)
1. Go to **Authentication** → **Email Templates**
2. Under **SMTP Settings**, configure:
   - SMTP Host (e.g., `smtp.gmail.com`, `smtp.sendgrid.net`)
   - SMTP Port (usually 587 or 465)
   - SMTP User (your email service username)
   - SMTP Password (your email service password)
   - Sender email address

## 4. Update Email Templates (CRITICAL FOR PASSWORD RESET)

⚠️ **Important:** The email template MUST include `type=recovery` in the URL for password reset to work correctly.

1. Go to **Authentication** → **Email Templates**
2. For **Reset Password** template, use one of these formats:

   **Option A - Using ConfirmationURL (Recommended for PKCE):**
   ```
   <h2>Reset Password</h2>
   <p>Follow this link to reset the password for your user:</p>
   <p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
   ```
   
   **Option B - Manual URL construction (if ConfirmationURL doesn't include type):**
   ```
   <h2>Reset Password</h2>
   <p>Follow this link to reset the password for your user:</p>
   <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset Password</a></p>
   ```

   **The URL MUST include `type=recovery` parameter** for the callback handler to detect it's a password reset flow.

3. For **Magic Link** template, use:
   ```
   <a href="{{ .ConfirmationURL }}">
     Sign in
   </a>
   ```

4. **Verify the template**: After saving, test by sending a password reset email and checking the link URL includes `type=recovery`

## 5. Check Email Rate Limits

- Free tier has limits on emails per hour
- Check **Logs** in Supabase dashboard for email sending errors
- If rate limited, consider upgrading or using custom SMTP

## 6. Verify Environment Variables

Ensure these are set in your `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # or your production URL
```

## 7. Debug Steps

1. Check browser console for errors when clicking "Send reset link" or "Send magic link"
2. Check Supabase dashboard **Logs** → **Auth Logs** for errors
3. Verify the email address exists in Supabase Auth users
4. Check spam/junk folder for emails
5. Verify email service is properly configured in Supabase

## Common Issues

### "Error sending recovery email" or "Error sending recovery email"
This error typically means Supabase cannot send the email. Check:

1. **Email Service Not Configured**:
   - Go to **Authentication** → **Email Templates** → **SMTP Settings**
   - Configure SMTP (required for sending emails)
   - Or ensure Supabase's built-in email service is enabled (limited on free tier)

2. **Email Templates Not Enabled**:
   - Go to **Authentication** → **Email Templates**
   - Ensure "Reset Password" template is enabled
   - Check that templates are not disabled

3. **Rate Limiting**:
   - Free tier has strict email rate limits
   - Check **Logs** → **Auth Logs** for rate limit errors
   - Wait before trying again

4. **Email Address Issues**:
   - Ensure the email exists in your Supabase Auth users table
   - Verify email format is correct

### "Email rate limit exceeded"
- Solution: Wait or upgrade plan or use custom SMTP

### "Invalid redirect URL"
- Solution: Add the URL to whitelist in URL Configuration (must be `http://localhost:3000/auth/callback`)

### "Email not sent" (no error)
- Solution: Check SMTP configuration and email templates

### Emails go to spam
- Solution: Configure SPF/DKIM records for your domain (if using custom domain email)
