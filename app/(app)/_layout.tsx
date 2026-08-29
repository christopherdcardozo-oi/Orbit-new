import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Platform } from 'react-native';

export default function AppLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#030712' }}>
      <Tabs
        sceneContainerStyle={{ backgroundColor: '#030712' }}
        screenOptions={{
          headerShown: false,
          unmountOnBlur: true,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: '#c084fc',
          tabBarInactiveTintColor: '#6b7280',
          tabBarShowLabel: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={[styles.iconContainer, focused && styles.activeIcon]}>
                <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={size + 4} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={[styles.iconContainer, focused && styles.activeIcon]}>
                <Ionicons name={focused ? "person" : "person-outline"} size={size + 4} color={color} />
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
    position: 'absolute',
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
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    padding: 10,
    borderRadius: 20,
  },
  activeIcon: {
    backgroundColor: 'rgba(192, 132, 252, 0.15)',
  }
});
