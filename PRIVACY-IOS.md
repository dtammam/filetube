# Privacy policy: the FileTube iOS app

Effective date: 14 October 2026.

FileTube is a media server you run yourself. The FileTube iOS app is a window onto your own server. This page says what the
app does and does not do with your information, in plain language.

## The short version

- The app collects no data about you.
- It talks only to the FileTube server address you type in.
- Nothing is sent to the developer. There is no analytics, no tracking and no third-party SDK in the app.
- The app sends no notifications.

## What the app talks to

The app connects only to the FileTube server address you enter. The pages it shows are served by that server, and they load
no fonts, scripts or images from anywhere else; everything is hosted on your server. If a page has a link to somewhere else
(for example the project's release notes on GitHub), tapping it opens that site in Safari, outside the app. Requests the app
makes itself (pairing the device, saving media for offline use, and sending something from the iOS share sheet or a quick
action) go only to your configured server, over their own private connections, and a share never follows a redirect to a
different address.

## What the app keeps on your device

- the server address you entered
- the pairing token that lets the app sign in to your server, kept in the device Keychain
- media you chose to save for offline use, and the list of what is saved
- your playback progress, which also syncs to your own server
- the quick actions and Siri App Shortcuts, which run on the device

You can remove all of it by deleting the app, or by removing the device from your server's Settings, which revokes its token.

## What the developer receives

Nothing. The app has no connection to the developer, no account with the developer, and no analytics, advertising or tracking
code. It uses no third-party code libraries.

## Your server

What your own FileTube server stores and who can see it is up to whoever runs that server (usually you). The app does not
change that. If you use someone else's server, ask them how they handle your data.

## Contact

Questions or concerns: open an issue at <https://github.com/dtammam/filetube/issues>.
