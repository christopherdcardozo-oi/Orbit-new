import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CosmicBackground from '../../components/CosmicBackground';
import { View } from 'react-native';

export default function AppLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#030712' }}>
      <CosmicBackground />
      <Tabs
        sceneContainerStyle={{ backgroundColor: 'transparent' }}
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: 'rgba(3, 7, 18, 0.9)',
            borderTopColor: '#1f2937',
            borderTopWidth: 1,
            position: 'absolute',
            elevation: 0,
          },
          tabBarActiveTintColor: '#a855f7',
          tabBarInactiveTintColor: '#6b7280',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubbles" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
