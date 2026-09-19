import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AppLayout() {
  // Android 15 forces edge-to-edge for targetSdk 35+ (and
  // android/gradle.properties sets edgeToEdgeEnabled=true), so the bar
  // sits over the gesture area. react-navigation normally adds
  // insets.bottom to both the height and the padding, but the literal
  // `height` in styles.tabBar below overrode the height while leaving
  // the inset padding in place — on a gesture-nav device that squeezed
  // both icons into the top ~22dp of a 70dp bar. iOS is left alone: 88
  // already accounts for the home indicator and looks correct today.
  const insets = useSafeAreaInsets();
  const tabBarHeight = Platform.OS === 'ios' ? 88 : 70 + insets.bottom;
  return (
    <View style={{ flex: 1, backgroundColor: '#030712' }}>
      <Tabs
        screenOptions={{
          // Was a top-level `sceneContainerStyle` prop; in the current
          // bottom-tabs API this moved into `screenOptions` as `sceneStyle`.
          sceneStyle: { backgroundColor: '#030712' },
          headerShown: false,
          // NOTE: `unmountOnBlur` was removed from react-navigation bottom-tabs.
          // The transparent-overlay-on-web bug it originally fixed is now
          // handled by the opaque backgrounds on each screen (see the
          // "strictly separate screens with solid backgrounds" fix in git log).
          //
          // Was `position: 'absolute'` on tabBarStyle, floating the bar over
          // the scene content. Reported directly: "i dont see the bottom nav
          // bar cleanly" — with an opaque sceneStyle background on every
          // screen (needed for an unrelated transparent-overlay bug on web),
          // the absolutely-positioned bar rendered BEHIND that opaque scene
          // content instead of floating above it, making it fully invisible
          // (confirmed by forcing it bright red: nothing showed; zIndex/
          // elevation didn't fix it either — not a simple sibling z-order
          // fight). Normal document flow guarantees real, visible space.
          tabBarStyle: [
            styles.tabBar,
            Platform.OS === 'android' && {
              height: tabBarHeight,
              paddingBottom: insets.bottom,
            },
          ],
          tabBarActiveTintColor: '#c084fc',
          tabBarInactiveTintColor: '#6b7280',
          tabBarShowLabel: false,
          // Apple-HIG icon slot react-navigation allocates per tab
          // (views/TabBarIcon.js: wrapperUikit is a hardcoded 31×28px box,
          // the icon absolutely positioned to fill it) is genuinely tiny —
          // an earlier tabBarIcon wrapped each icon in its own padded
          // "pill" View (icon + 10px padding every side, ~48×48px total)
          // and that got crammed into the 31×28 slot and clipped to a
          // barely-visible sliver (confirmed with a console.log: color/
          // size props arriving were completely correct — size 25 — so
          // this was pure clipping, not a props bug). First fix moved the
          // highlight to the whole tab-item (tabBarActiveBackgroundColor),
          // which worked but read as a wide rectangle spanning the tab's
          // full touch width, not a highlight around the icon itself.
          // tabBarIconStyle overrides that tiny 31×28 slot directly (it's
          // merged in after the library's own size, so ours wins) — sized
          // up to 44×44 here gives enough room for a real circle behind
          // just the icon, back in tabBarIcon below, without clipping.
          tabBarIconStyle: styles.tabBarIcon,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={[styles.iconCircle, focused && styles.iconCircleActive]}>
                <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={[styles.iconCircle, focused && styles.iconCircleActive]}>
                <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
              </View>
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderTopWidth: 0,
    elevation: 0,
    height: Platform.OS === 'ios' ? 88 : 70,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } : {}),
  },
  // Widened icon slot — see the tabBarIconStyle comment above. Centers
  // the (still small) icon inside the enlarged 44×44 box so iconCircle
  // below has room to sit centered behind it.
  tabBarIcon: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // A tight circle behind just the icon (not the whole tab's touch
  // width) — requested directly: the earlier full-tab-width pill read
  // as a rectangle, not a highlight around the icon.
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleActive: {
    backgroundColor: 'rgba(192, 132, 252, 0.15)',
  },
});
