// Web-only — configures the root <html>/<head> for every page during
// static rendering. Runs in Node.js only, no DOM/browser APIs here.
// Convention: https://docs.expo.dev/router/reference/static-rendering/#root-html
//
// Extends Expo's default template (@expo/cli/static/template/+html.tsx)
// with PWA install support: a manifest so Chrome/Edge/Android offer their
// native "Install app" prompt, plus the Apple-specific meta tags iOS
// Safari needs for "Add to Home Screen" (iOS has no install-prompt API at
// all — see components/InstallHint.tsx for the manual instructions shown
// there).

import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* interactive-widget=resizes-content tells iOS Safari / Chrome to
            actually shrink the layout viewport when the on-screen keyboard
            opens, instead of leaving the page at its pre-keyboard height —
            which is what caused the blank white gap below the form.
            maximum-scale=1 + minimum-scale=1 + user-scalable=no locks the
            zoom level in both directions: without minimum-scale specifically,
            Safari can still auto-zoom OUT on its own (not a user pinch) if
            any element ever briefly overflows the viewport width — e.g.
            during a route transition — and it does not zoom back in once
            that overflow is gone. That's what caused the "zoomed out with
            blank margins" state on every navigation, not just the
            keyboard-focus case. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no, viewport-fit=cover, interactive-widget=resizes-content"
        />

        {/* Belt-and-suspenders for the same bug: if anything still manages
            to overflow horizontally for a frame, clipping it here means
            there's nothing for Safari's auto-fit zoom to react to. */}
        <style>{`html, body, #root { overflow-x: hidden; max-width: 100vw; }`}</style>

        {/* Disable body scrolling on web so ScrollView behaves like native. */}
        <ScrollViewStyleReset />

        {/* PWA install support */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#030712" />

        {/* iOS Safari: enables standalone (fullscreen, no browser chrome)
            mode once added to the home screen, and sets the home-screen
            icon/title. iOS ignores manifest.json entirely for these. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Orbit" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
