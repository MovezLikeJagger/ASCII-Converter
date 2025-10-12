# Android Shell App

This directory contains a native Android host for the ASCII Converter web experience. The app embeds the Vite build output inside an Android WebView so the converter can run fully offline on Android devices.

## Preparing the web assets

1. Install the JavaScript dependencies.
   ```bash
   npm install
   ```
2. Build the production bundle.
   ```bash
   npm run build
   ```
3. Copy the generated files from `dist/` into `android/app/src/main/assets/public/`.
   The placeholder `index.html` in that folder can be replaced entirely by the contents of `dist`.

## Building the Android project

1. Ensure you have the Android SDK, Java 17, and the `gradle` CLI (or Android Studio) installed locally.
2. From the `android/` folder, generate a Gradle wrapper if one is not present yet:
   ```bash
   gradle wrapper
   ```
3. Use the wrapper to build or run the project:
   ```bash
   ./gradlew assembleDebug
   ```
4. To open the project in Android Studio, choose **Open an Existing Project** and select the `android/` directory.

The `MainActivity` hosts a WebView configured with an `AssetLoader`, so the bundled files load from `https://appassets.androidplatform.net/public/index.html`. External links open in the user's default browser.
