# Nutrino

Nutrino is a local-first nutrition and health diary for mobile and desktop. It helps you track meals, recipes, fluids, activities, weight, and health notes while keeping your personal diary data under your control.

- [Overview](#overview)
- [Installation](#installation)
  - [Android](#android)
  - [iOS](#ios)
  - [Desktop](#desktop)
- [First launch](#first-launch)
- [Features](#features)
  - [Meal diary](#meal-diary)
  - [Fluid tracking](#fluid-tracking)
  - [Recipes and catalog](#recipes-and-catalog)
  - [Activity and weight](#activity-and-weight)
  - [Health diary](#health-diary)
  - [Backups and exports](#backups-and-exports)
  - [Desktop handoff](#desktop-handoff)
- [Updates](#updates)
- [Privacy](#privacy)
- [License](#license)

## Overview

Nutrino is built for everyday personal tracking. The app can be used without a central cloud account, and the mobile diary stays local unless you explicitly export or share data.

The desktop app can act as a trusted local-network companion for catalog management and controlled handoff requests. The mobile app decides whether a desktop request is allowed, rejected, or scoped to specific exported data.

## Installation

Download Nutrino from the GitHub Releases page of this repository. Choose the package that matches your device and operating system.

### Android

Install the Android APK from the latest release. Android may ask you to allow installation from the browser or file manager you used to open the APK.

After installing, keep future APK updates signed with the same release key. Android will reject an update if the app signature does not match the already installed version.

### iOS

Install the iOS build only from a trusted signed package. iOS installation requires valid Apple signing and provisioning.

### Desktop

Use the Windows, macOS, or Linux package from the latest release. The desktop app is optional, but useful if you want a larger-screen catalog editor or local-network handoff with the mobile app.

## First launch

On first launch, set up your profile so Nutrino can estimate daily energy targets:

```text
height
current weight
birthday
gender
activity level
weekly goal
tracking purpose
```

You can change these values later from the Profile and Settings areas.

## Features

### Meal diary

Use the quick add button to log meals into breakfast, lunch, dinner, or snack. You can select an existing catalog item, customize recipe amounts for a diary entry, or add a temporary meal note that can be converted into a proper food later.

Nutrino shows daily kcal, macros, optional micronutrients, remaining kcal, deficit status, and diary history by day.

### Fluid tracking

Use the quick add button and choose “I drank fluid” to record fluid amount in deciliters. Quick amount buttons are available for 1 dl, 2 dl, and 3 dl.

Alcohol can be marked separately. When alcohol is enabled, Nutrino adds an estimated kcal value to the day. Built-in estimates cover beer, wine, spirits, cocktails, and custom alcohol entries.

### Recipes and catalog

Nutrino supports ingredients, foods, recipes, and barcode-based catalog entries. Recipes are calculated from their components, and foods can include kcal, macros, and optional micronutrients.

Cooked or fried variants should not need separate duplicate foods. When supported, choose a preparation method during logging instead:

```text
boiled or steamed
air fryer
pan-fried with light oil
pan-fried with normal oil
deep-fried
custom oil amount
```

The selected preparation method adjusts the logged diary entry while the base catalog item stays clean.

### Activity and weight

Activities can be logged from the activity catalog or as manual burned kcal. Weight entries are used for the profile, BMI, and progress tracking.

### Health diary

Health diary entries can record symptoms, notes, recurring events, status, and media attachments when the feature is enabled.

### Backups and exports

Nutrino can export app data as a local backup. Backups can include catalog data, food diary data, health diary data, and health media depending on the selected scope.

AI Markdown export is available when you want a readable, scoped summary for external analysis.

### Desktop handoff

The desktop app can request a mobile export over the local network. The mobile app must approve the request before data is sent. Large exports are uploaded in chunks to avoid broken zero-byte transfers.

## Updates

The mobile app can check for newer releases. Android updates require matching app signatures; if an update is signed with a different key, Android will refuse to install it over the existing app.

Desktop and mobile release packages are published through GitHub Releases.

## Privacy

Nutrino is designed around local data ownership. Diary data, backups, health entries, media, and AI exports are only shared when you explicitly export, import, approve a handoff, or copy the generated data yourself.

Desktop sync is catalog-oriented. Mobile meal diary entries, activity logs, and weight logs are treated as private mobile data and are not silently uploaded to the desktop catalog inbox.

## License

Nutrino is licensed under `AGPL-3.0-only`.
