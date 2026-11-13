import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Fonts } from '../theme/tokens';
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import MapScreen from '../screens/Map/MapScreen';
import PairScreen from '../screens/Pair/PairScreen';
import HistoryScreen from '../screens/History/HistoryScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function DashboardStack({ onLogout }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard">
        {(props) => <DashboardScreen {...props} onLogout={onLogout} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function MapStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Map" component={MapScreen} />
    </Stack.Navigator>
  );
}

function SettingsStack({ onLogout }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Settings">
        {(props) => <SettingsScreen {...props} onLogout={onLogout} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

const TABS = [
  { name: 'HomeTab', label: 'Home', activeIcon: 'home', inactiveIcon: 'home-outline' },
  { name: 'MapTab', label: 'Map', activeIcon: 'map', inactiveIcon: 'map-outline' },
  { name: 'HistoryTab', label: 'History', activeIcon: 'time', inactiveIcon: 'time-outline' },
  { name: 'PairTab', label: 'Pair', activeIcon: 'qr-code', inactiveIcon: 'qr-code-outline' },
  { name: 'SettingsTab', label: 'Settings', activeIcon: 'settings', inactiveIcon: 'settings-outline' },
];

function FloatingGlassTabBar({ state, descriptors, navigation }) {
  return (
    <View style={styles.tabBarOuterWrapper} pointerEvents="box-none">
      <View style={styles.dockedBarContainer}>
        {/* Dark Background with matching borderRadius */}
        <LinearGradient
          colors={['rgba(8, 14, 32, 0.98)', 'rgba(6, 11, 26, 0.98)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 32 }]}
        />

        <View style={styles.tabsRow}>
          {state.routes.map((route, index) => {
            const isFocused = state.index === index;
            const tabInfo = TABS.find((t) => t.name === route.name) || {
              label: route.name,
              activeIcon: 'help-circle',
              inactiveIcon: 'help-circle-outline',
            };

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                onPress={onPress}
                activeOpacity={0.75}
                style={styles.tabItem}
              >
                {isFocused ? (
                  <View style={styles.activeTabContainer}>
                    {/* Glowing rounded highlight matching attached mockup */}
                    <LinearGradient
                      colors={['rgba(110, 75, 235, 0.75)', 'rgba(95, 65, 215, 0.30)', 'transparent']}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={styles.activeGlowPill}
                    />
                    <View style={styles.iconWrapper}>
                      <Icon name={tabInfo.activeIcon} size={21} color="#FFFFFF" />
                    </View>
                    <Text style={styles.tabLabelActive} numberOfLines={1}>
                      {tabInfo.label}
                    </Text>
                    <View style={styles.activeIndicator} />
                  </View>
                ) : (
                  <View style={styles.inactiveTabContainer}>
                    <View style={styles.iconWrapper}>
                      <Icon name={tabInfo.inactiveIcon} size={21} color="#6E81A0" />
                    </View>
                    <Text style={styles.tabLabelInactive} numberOfLines={1}>
                      {tabInfo.label}
                    </Text>
                    <View style={styles.inactiveIndicatorPlaceholder} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export function MainNavigator({ onLogout }) {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      tabBar={(props) => <FloatingGlassTabBar {...props} />}
      sceneContainerStyle={{ backgroundColor: '#070A13' }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
      }}
    >
      <Tab.Screen name="HomeTab">
        {(props) => <DashboardStack {...props} onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen name="MapTab" component={MapStack} />
      <Tab.Screen name="HistoryTab" component={HistoryScreen} />
      <Tab.Screen name="PairTab" component={PairScreen} />
      <Tab.Screen name="SettingsTab">
        {(props) => <SettingsStack {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarOuterWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 16 : 12,
    left: 12,
    right: 12,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dockedBarContainer: {
    width: '100%',
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(105, 95, 215, 0.70)',
    backgroundColor: '#070D22',
    paddingVertical: 3,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  tabsRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  activeGlowPill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 4,
    right: 4,
    borderRadius: 18,
  },
  inactiveTabContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 26,
  },
  tabLabelActive: {
    fontSize: 10.5,
    color: '#FFFFFF',
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    textAlign: 'center',
    marginTop: 1,
  },
  tabLabelInactive: {
    fontSize: 10.5,
    color: '#6E81A0',
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    textAlign: 'center',
    marginTop: 1,
  },
  activeIndicator: {
    width: 20,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#A855F7',
    marginTop: 2,
  },
  inactiveIndicatorPlaceholder: {
    width: 20,
    height: 3,
    marginTop: 2,
  },
});

export default MainNavigator;
