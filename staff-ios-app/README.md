# TATO Staff iOS App

Expo/React Native employee task app for TATO.

## What It Does

- Staff signs in with the same Mini Program Code shown in TATO staff scheduling.
- The app stores the session token in iOS Keychain through `expo-secure-store`.
- Staff can view assigned tasks, subtasks, history tasks, task photos, and staff notes.
- Staff can edit task text, mark tasks complete/reopen, move tasks back to unassigned, and upload compressed task photos.

## Local Run

```bash
cd staff-ios-app
npm install
npx expo start --ios
```

By default the app talks to production:

```bash
https://tatocar.co
```

For local backend testing:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 npx expo start --ios
```

If testing on a physical iPhone against a local Mac server, use the Mac LAN address instead of `localhost`.

## TestFlight Build

Prerequisites:

- Expo account
- Apple Developer Program membership
- App Store Connect app with Bundle ID `co.tatocar.staff`

Commands:

```bash
cd staff-ios-app
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios --profile production
eas submit --platform ios
```

After submission, enable the build in App Store Connect TestFlight and invite internal or external testers.

## Notes

- Push notification registration is not wired yet. The app is ready for the task API layer; APNs device-token registration can be added next under `/api/staff-app/push-token`.
- The app uses `expo-image-picker` and `expo-image-manipulator` to select or take photos and compress them before upload.
