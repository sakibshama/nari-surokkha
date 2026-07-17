# Nari Surokkha Mobile App — apps/mobile

React Native TypeScript citizen and responder app for the Nari Surokkha safety platform.

## Tech Stack

- **Framework**: React Native 0.74+
- **Language**: TypeScript
- **Navigation**: React Navigation 6
- **State / Data**: React Query + Zustand + MMKV
- **Notifications**: Firebase Cloud Messaging
- **Maps**: Google Maps (react-native-maps)
- **Secure Storage**: react-native-keychain (tokens)
- **HTTP**: Axios
- **Sensors**: react-native-sensors
- **ML On-device**: TensorFlow Lite (Phase 16)

## Platform

**Android first** (Phase 11). iOS support in later phases.

## Setup (Phase 11)

```bash
# Prerequisites: Android Studio, Android SDK, JDK 17
cd apps/mobile

npm install

# Android
npx react-native run-android

# Copy env
cp .env.example .env
```

## Screens

| Screen | Purpose | Phase |
|--------|---------|-------|
| Splash | App loading | 11 |
| Onboarding | First-time walkthrough | 11 |
| Login | Phone + password | 11 |
| Register | New account | 11 |
| Profile Setup | Emergency profile | 11 |
| Home | SOS button + status | 11 |
| Trusted Contacts | Manage emergency contacts | 11 |
| SOS Active | Live SOS status + location | 11 |
| Settings | App settings | 11 |
| Soft Alert | 15s countdown | 15 |

## Language

The UI is **Bangla-first (বাংলা)** with English available as a switch.

## Emergency Call

The SOS screen shows a prominent **"999 কল করুন"** button for direct emergency calls.

## Permissions Required

- ✅ Location (Fine + Background)
- ✅ Camera (evidence)
- ✅ Microphone (evidence + audio detection)
- ✅ Notifications (push alerts)
- ✅ Phone (emergency call)
