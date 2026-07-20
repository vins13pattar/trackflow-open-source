# TrackFlow Mobile (Expo)

React Native app that turns a phone into a tracker: sign in, pick a registered
device, and report live GPS to `POST /devices/:id/report`. Also registers for
push notifications.

> Excluded from the pnpm workspace (native modules don't hoist well). Install and
> run it with the Expo toolchain directly.

## Run

```bash
cd apps/mobile
npm install
npx expo start            # then press i / a, or scan the QR with Expo Go
```

Point it at your API by editing `expo.extra.apiBaseUrl` in `app.json` (use your
machine's LAN IP, not localhost, when running on a physical device).

## Structure

- `App.tsx` — auth gate (Login vs Home)
- `src/lib/api.ts` — API client (token in SecureStore)
- `src/lib/tracking.ts` — foreground location watch → position reports
- `src/lib/push.ts` — Expo push registration
- `src/screens/` — Login and Home (device picker + start/stop tracking)

Background tracking (expo-task-manager) and server-side push delivery (an Expo
push channel in `@trackflow/notifications`) are the next enhancements.
