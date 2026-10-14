# Demo server for App Store review

App Review needs a server it can sign in to (guideline 2.1). This page is the recipe for one, and the text for App Store
Connect's review notes. The server is a plain FileTube, set up so that nothing in it could be mistaken for a downloader and
nothing in it needs a person to be around.

## The server

- **Public HTTPS.** Put it behind a reverse proxy with a real certificate (for example Nginx Proxy Manager with Let's
  Encrypt), and set `FILETUBE_TRUST_PROXY=1` so cookies are marked Secure (see
  [the accounts section](../CONFIGURATION.md#accounts--signing-in-v143)). The reviewer types this address into the app.
- **The downloader off.** Leave `FILETUBE_YTDLP_ENABLED` unset. With it unset the server has no `/api/ytdlp/*` or
  `/api/subscriptions/*` routes at all. (The App Store build also hides that interface itself, because it does not announce
  the `mediaFetch` capability: see [native-bridge.md](native-bridge.md).)
- **The image pinned, updates off.** Run exactly `deantammam/filetube:1.391.0`, never `latest`, and turn off any automatic
  updater (Watchtower or similar) for the length of the review, so the server cannot change under the reviewer.
- **Push off.** Nothing to configure: the app sends no notifications.

## The account

Create it in Settings > Users as a plain member (not an admin) with a long random password, and write both down for the
review notes. The account itself does not expire. Sign-ins do: a web session lasts 30 days and is renewed while it is used, up to 180 days
after the password was last typed; the app's pairing token expires after 180 days unused. So test a fresh pairing shortly
before you submit, and again if the review runs long. If you
ever need to re-enable or reset the account, see "Forgot the admin password?" in the same accounts section.

## The media

Only content you are free to show, with sources named in the review notes:

- **Video:** the Blender open movies (CC BY, for example Big Buck Bunny, Sintel, Tears of Steel), and public-domain films from
  the Internet Archive.
- **Music:** CC-licensed tracks from the Free Music Archive or ccMixter, enough to give Pocket something to play and to test
  background audio. Several albums, with cover art, so the library looks like a library.
- **Audiobooks and podcasts:** LibriVox recordings (public domain), added as a podcast feed or as files.
- **Books:** Project Gutenberg EPUBs (public domain).

Add the folders in Settings (Videos, Music, Books) and press **Save & Scan Library**. Check that offline saving works from
the app on the demo content, since a reviewer may try it.

## App Store Connect review notes (template)

> The app is a viewer for a self-hosted media server called FileTube; it shows the library of whatever server the user types
> in. For review, use this demo server:
>
> Server address: https://<your demo address>
> Username: <member username>
> Password: <password>
>
> The demo library contains only public-domain or Creative Commons media (Blender open movies, Internet Archive films, Free
> Music Archive and ccMixter music, LibriVox audio, Project Gutenberg books). The app has no accounts of its own, collects no
> data, contains no analytics or third-party SDKs, and sends no notifications. It talks only to the server address entered.
> Pocket is inspired by classic click-wheel players; the app is not affiliated with Apple or Google. Privacy policy:
> https://github.com/dtammam/filetube/blob/main/PRIVACY-IOS.md
