# ASCII-Converter
Turn any image into stunning ASCII art directly in your browser. Upload, drag-drop, paste, or import via URL — no server, no tracking. Features include gamma correction, colorized output, and adjustable ASCII width, all built with React + TailwindCSS.

## Android version

An Android host project is available in [`android/`](android/). It wraps the existing web build inside a native shell so you can ship the converter as an Android APK.

### Build steps

1. Install JS dependencies and produce a production build:
   ```bash
   npm install
   npm run build
   ```
2. Copy the generated `dist/` contents into `android/app/src/main/assets/public/` (replace the placeholder HTML file).
3. From the `android/` folder, generate a Gradle wrapper if needed with `gradle wrapper` and then build the app via `./gradlew assembleDebug` or open the project in Android Studio.

See [`android/README.md`](android/README.md) for additional details.
