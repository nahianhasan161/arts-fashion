# Arts Fashion E-Commerce Store - Authentication

This directory contains Next.js pages for user authentication:
- `/sign-in` - Sign in page
- `/sign-up` - Sign up page
- `/account` - Account/profile management page
- `/auth/callback` - OAuth callback handler

## Features

- Email/password authentication
- Google OAuth integration
- Profile management
- Account preferences

## Dependencies

Requires `@supabase/ssr` for server-side authentication and `@supabase/supabase-js` for client operations.

## Setup

Configure your Supabase project credentials in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here
```

## Files

- `src/lib/supabase/client.ts` - Browser client configuration
- `src/lib/supabase/server.ts` - Server client configuration
- `src/components/auth/` - Authentication components
- `src/lib/auth/` - Authentication utilities

## Note

If you do not configure Supabase right away, the authentication system will fall back to its built-in functionality.
