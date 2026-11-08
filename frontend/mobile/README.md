# Universal Publishing — Mobile App

Native iOS + Android app for Universal Publishing Platform.

Built with **React Native** + **Expo** + **Expo Router** + **Zustand**.

---

## 🎯 Features

| Screen | Description |
|---|---|
| **Login/Register** | Email/password auth with SecureStore tokens |
| **Feed** | Latest posts from followed authors |
| **Drafts** | List, create, edit, publish drafts |
| **Editor** | Write + publish (v1: plain text; v2: rich text) |
| **Marketplace** | Browse items + purchase via Stripe |
| **Wallet** | Balance + payout request |
| **Profile** | User info + logout |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+**
- **Expo CLI** (`npm install -g expo-cli` — optional, use `npx expo` instead)
- **iOS Simulator** (macOS) or **Android Emulator** or **physical device** with Expo Go

### Setup

```bash
cd frontend/mobile
npm install
cp .env.example .env
```

### Run

```bash
# Start Metro bundler + dev server
npm start

# Then press:
#   i → open iOS simulator
#   a → open Android emulator
#   w → open web browser
#   Scan QR code → Expo Go app on physical device
```

### Configure API URL

Edit `.env`:
```
EXPO_PUBLIC_API_URL=http://localhost:8080
```

**Note for physical devices**: `localhost` won't work. Use your machine's LAN IP:
```
EXPO_PUBLIC_API_URL=http://192.168.1.100:8080
```

---

## 🏗️ Architecture

```
app/                          (Expo Router — file-based routing)
├── _layout.tsx              Root stack
├── index.tsx                Entry redirect
├── (auth)/
│   ├── _layout.tsx          Auth stack
│   ├── login.tsx
│   └── register.tsx
├── (tabs)/
│   ├── _layout.tsx          Bottom tabs
│   ├── index.tsx            Home (feed)
│   ├── editor.tsx           Drafts list
│   ├── marketplace.tsx      Browse items
│   ├── wallet.tsx           Balance + payout
│   └── profile.tsx          User info
└── editor/
    └── [id].tsx             Draft editor

src/
├── api/
│   ├── tokens.ts            SecureStore wrapper
│   ├── client.ts            Axios + interceptors
│   ├── auth.api.ts
│   ├── editor.api.ts
│   ├── feed.api.ts
│   ├── marketplace.api.ts
│   └── wallet.api.ts
├── store/
│   └── auth.store.ts        Zustand + SecureStore
├── components/
│   ├── PostCard.tsx
│   └── ScreenWrapper.tsx
├── utils/
│   └── format.ts
├── theme/
│   └── colors.ts
└── types/
    └── index.ts
```

---

## 🔐 Security

### Token storage
- Uses **expo-secure-store** → iOS Keychain, Android Keystore
- Never stored in AsyncStorage (not encrypted)
- Never stored in Zustand state (memory only)

### Refresh token flow
- Axios interceptor refreshes automatically on 401
- Pending requests are queued
- On refresh failure → tokens cleared, redirect to login

### API client
- Bearer token attached to every request
- Refresh loop prevented (`_retry` flag)
- Skips refresh for `/auth/login` and `/auth/refresh`

---

## 🧪 Testing

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
```

For UI testing, use:
- **Expo Go** on physical device
- **iOS Simulator** (macOS only)
- **Android Emulator** (via Android Studio)

---

## 📦 Building for Production

### iOS (requires Apple Developer account)

```bash
npx expo build:ios
# Or EAS:
npm install -g eas-cli
eas build --platform ios
```

### Android (requires Google Play Developer account)

```bash
npx expo build:android
# Or EAS:
eas build --platform android
```

### Recommended: EAS Build

```bash
eas login
eas build:configure
eas build --platform all
```

---

## 🔄 Environment Configuration

`app.json` `extra` section:
```json
"extra": {
  "apiUrl": "http://localhost:8080",
  "wsUrl": "ws://localhost:8080/editor/stream"
}
```

Access in code:
```typescript
import Constants from 'expo-constants';
const apiUrl = Constants.expoConfig?.extra?.apiUrl;
```

---

## 🩺 Troubleshooting

**Metro bundler crash**
```bash
rm -rf node_modules .expo
npm install
npx expo start --clear
```

**"Network request failed"**
- Check `EXPO_PUBLIC_API_URL` is set
- On physical device, use LAN IP, not `localhost`
- Check firewall allows port 8080

**SecureStore fails**
- Reinstall the app (SecureStore bindings require native rebuild)
- `npx expo prebuild --clean` for dev builds

**Login works on web but not on device**
- `expo-secure-store` doesn't work on web (uses localStorage fallback in some setups)
- Use `expo start --web` for testing only

---

## 📝 License

Proprietary — All rights reserved.