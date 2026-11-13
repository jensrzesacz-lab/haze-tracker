# Haze Tracker SG

A progressive web app showing Singapore's 24-hour PSI and 1-hour PM2.5 by region
(north, south, east, west, central, plus the national figure), using NEA data from
[data.gov.sg](https://data.gov.sg). You can set a region and a PSI threshold and get a
notification when the 24-hour PSI reaches it.

## Run it

It is a static site with no build step. Serve the folder over HTTPS (service workers and
notifications need it; `localhost` also works):

    python3 -m http.server 8000

To host it, turn on GitHub Pages for this repo (Settings > Pages > deploy from `main`, root).
All paths are relative, so it works under `/haze-tracker/`.

## Add to home screen

- Android Chrome: use the in-app "Install app" button, or the browser menu.
- iPhone Safari: Share > Add to Home Screen. Notifications on iOS only work from the
  home-screen app (iOS 16.4+).

## Notifications: what to expect

There is no push server, so alerts are checked on the device:

- While the app is open, it re-checks every 5 minutes and when you return to it.
- On Android Chrome with the app installed, the browser may also run a background check
  (Periodic Background Sync). The browser decides how often, typically a few times a day at
  best, and not at all if the app is rarely used.
- A notification fires when the value goes from below the threshold to at or above it,
  not on every check.

For reliable alerts while the app is closed, a small server that polls NEA and sends Web Push
messages would be needed.

## Data notes

- NEA publishes the PSI as a 24-hour figure. The "1-hour" reading shown is the 1-hour PM2.5
  concentration (`pm25_one_hourly`), which NEA reports separately.
- Endpoints: `https://api-open.data.gov.sg/v2/real-time/api/psi` and `.../pm25`.

## Tests

    node test/core.test.js

## Icons

`icons/icon.svg` is the source. PNGs were rendered with `rsvg-convert`.
