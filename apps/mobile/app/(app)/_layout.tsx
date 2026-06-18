import { Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '@/constants/theme';

function TabIcon({ label, color }: { label: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{label}</Text>;
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgSurface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon label="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="quests"
        options={{
          title: 'Quests',
          tabBarIcon: ({ color }) => <TabIcon label="⚔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Histórico',
          tabBarIcon: ({ color }) => <TabIcon label="◷" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'IA',
          tabBarIcon: ({ color }) => <TabIcon label="✦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notas',
          tabBarIcon: ({ color }) => <TabIcon label="✎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="graph"
        options={{
          title: 'Grafo',
          tabBarIcon: ({ color }) => <TabIcon label="⬡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Relatórios',
          tabBarIcon: ({ color }) => <TabIcon label="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Config',
          tabBarIcon: ({ color }) => <TabIcon label="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
