# Araksha-Frontend

Internal staff system for **Araksha by Samson Insurance Brokers (Pvt) Ltd** — client management, quotations, claims, renewals, portfolio reviews, reports and admin, with branded PDF and Excel exports/imports.

Built with React (CRA), Material UI and Firebase (Auth + Firestore + Storage).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the Firebase and EmailJS values
   (create the Firebase project first — see `SETUP.md` in the parent workspace).
3. `npm start` — runs on <http://localhost:3000>

## Build

```
npm run build
```

Outputs a static bundle to `build/` (relative paths, deployable to any static host).

## Notes

- `.env` is git-ignored — never commit real Firebase/EmailJS keys.
- Firestore/Storage security rules live in the parent workspace (`firestore.rules`, `storage.rules`) and are deployed with `deploy_rules.bat`.
