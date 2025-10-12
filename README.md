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

## GitHub workflow: keeping web + Android side by side

The Android shell lives in the `android/` subfolder, so you can keep it in the
same repository as the existing web app. To publish both without one replacing
the other on GitHub:

1. Commit the changes from the web project **and** the `android/` directory on
   the same branch (for example `feature/android-shell`). The root level React
   app stays untouched, while everything Android-specific is scoped to the
   nested folder.
2. Open a pull request that merges the branch back into your main branch. On
   GitHub this means you keep your original project history while adding the
   new Android files alongside it.
3. When you cut releases, you can continue to use GitHub Pages (or any static
   hosting) for the web build, and optionally upload Android `.apk` artifacts
   produced from the `android/` project as release assets. Neither workflow
   removes the other.

In short: keep the existing files in place, add the `android/` directory, and
merge through the normal Git flow—GitHub will treat the Android host as an
additional deliverable in the repository.
