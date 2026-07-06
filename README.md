# Collection Pit — Website

Web companion for the Collection Pit MTG collection manager.
React + Vite + TypeScript, with Firebase Authentication (Google sign-in),
Cloud Firestore, and Firebase Hosting. Firebase project: `collection-pit`.

## Setup

1. **Install dependencies**

   ```
   npm install
   ```

2. **Configure Firebase (one-time)**

   Copy `.env.example` to `.env` and fill in the values from the
   [Firebase console](https://console.firebase.google.com/) →
   project **collection-pit** → Project settings → Your apps → Web app →
   SDK setup and configuration (the `firebaseConfig` object):

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

   `.env` is gitignored — never commit it. Also make sure **Google** is
   enabled as a sign-in provider (Authentication → Sign-in method) and
   that **Cloud Firestore** is created for the project.

3. **Run locally**

   ```
   npm run dev
   ```

   Opens the login screen; "Sign in with Google" takes you to the Home
   page. The session survives refreshes.

## Deploy

1. **Log in the Firebase CLI (one-time)**

   ```
   firebase login
   ```

2. **Publish** (builds, then uploads Hosting + Firestore rules/indexes)

   ```
   npm run deploy
   ```

   or equivalently `npm run build && firebase deploy`.

## Project layout

- `src/lib/firebase.ts` — Firebase init from `VITE_FIREBASE_*` env vars;
  exports `auth`, `googleProvider`, `db`.
- `src/auth/` — `AuthProvider` context (user, loading, sign-in/out) and
  the `useAuth()` hook.
- `src/App.tsx` — router shell: spinner while auth resolves, Login page
  when signed out, Home page when signed in.
- `firebase.json` / `.firebaserc` — Hosting (SPA rewrite to
  `/index.html`) and Firestore rules/indexes wiring.
- `firestore.rules` — each signed-in user can only access documents
  under `/users/{their-uid}/…`.
