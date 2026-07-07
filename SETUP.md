# SideEye — Setup (Mic's to-do list)

Two free accounts to create, ~15 minutes. Do these in order, paste the keys into a `.env` file (copy `.env.example`), and tell Claude when done.

## 1. Supabase (database + storage + functions)

1. Go to https://supabase.com → Sign up (GitHub or email).
2. Create a new project: name `sideeye`, region **Sydney (ap-southeast-2)**, generate a strong DB password and save it somewhere safe.
3. Once created: Project Settings → API. Copy:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
4. That's it — Claude will run the migrations (`supabase/migrations/001_init.sql` then `seed.sql`) via the SQL Editor or CLI next session.

## 2. Basiq (bank data, sandbox — free)

1. Go to https://dashboard.basiq.io → Sign up.
2. Create an application (name: SideEye, purpose: personal).
3. Copy the **API key** — this is server-side only. Don't put it in `.env` in this folder; you'll paste it into Supabase (Dashboard → Edge Functions → Secrets → `BASIQ_API_KEY`) when we wire up sync.
4. Sandbox note: test with Basiq's fake "Hooli Bank" first; connecting real Westpac happens in Phase 8 under a production key.

## 3. Later (not yet)

- **Apple Developer Program** (US$99/yr) — only when you're ready to move from PWA to TestFlight.
- **GitHub repo** — optional but recommended once code stabilises; say the word and Claude sets it up.

## Running the app (dev)

Claude handles this in-session, but for reference:

```
npm install
npm run web      # dev server in browser / PWA
```
