// Cross-platform confirm / notify.
//
// react-native-web ships Alert as `class Alert { static alert() {} }` —
// a literal no-op. Any flow whose action lived inside an Alert callback
// therefore did nothing at all on web, silently. That included:
//
//   * Delete Account (app/(app)/profile.tsx) — the one flow Apple
//     requires under guideline 5.1.1(v)
//   * Ban / Unban (app/admin/users.tsx)
//
// and every error message raised with Alert.alert, which simply never
// appeared. The codebase already knew (profile.tsx: "Alert.alert is a
// silent no-op on web") but still depended on it.
//
// Native keeps the real Alert. Web uses the browser dialogs, which are
// synchronous and reliable; a nicer in-app modal can replace this later
// without changing any call site, since the contract is a Promise.

import { Alert, Platform } from 'react-native';

export function confirm(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const {
    title,
    message = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
  } = options;

  if (Platform.OS === 'web') {
    try {
      return Promise.resolve(
        window.confirm(message ? `${title}\n\n${message}` : title),
      );
    } catch {
      // Dialogs suppressed (sandboxed iframe, some embedded webviews).
      // Refusing is the safe answer for a destructive prompt.
      return Promise.resolve(false);
    }
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      // Android back-button / tap-outside dismissal resolves false
      // instead of leaving the promise hanging forever.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function notify(title: string, message = ''): void {
  if (Platform.OS === 'web') {
    try {
      window.alert(message ? `${title}\n\n${message}` : title);
    } catch {
      console.warn(title, message);
    }
    return;
  }
  Alert.alert(title, message);
}
