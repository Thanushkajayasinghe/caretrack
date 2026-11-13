import React, { useEffect, useState } from 'react';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthNavigator } from './src/navigation/AuthNavigator';
import MainNavigatorDefault, { MainNavigator as MainNavigatorNamed } from './src/navigation/MainNavigator';
import ColorsDefault, { Colors as ColorsNamed } from './src/theme/tokens';
import { connectSocket } from './src/services/socket';
import { initServerConfig } from './src/config/server';

const MainNavigator = MainNavigatorDefault || MainNavigatorNamed;
const Colors = ColorsNamed || ColorsDefault || {};

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#070A13',
    card: '#0D1324',
    border: 'transparent',
    text: '#F8FAFC',
  },
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await initServerConfig();
      const token = await AsyncStorage.getItem('accessToken');
      const parentId = await AsyncStorage.getItem('parentId');
      console.log('🔑 checkAuth: token =', Boolean(token), 'parentId =', Boolean(parentId));
      if (token && parentId) {
        setIsAuthenticated(true);
        connectSocket();
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('🔑 checkAuth error:', err);
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#070A13' }}>
        <SafeAreaProvider>
          <StatusBar barStyle="light-content" backgroundColor="#070A13" translucent={false} />
          <View style={{ flex: 1, backgroundColor: '#070A13', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#070A13' }}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#070A13' }}>
        <StatusBar
          barStyle="light-content"
          backgroundColor="#070A13"
          translucent={false}
        />
        <NavigationContainer theme={navTheme}>
          {isAuthenticated ? (
            <MainNavigator onLogout={() => setIsAuthenticated(false)} />
          ) : (
            <AuthNavigator onLogin={() => {
              connectSocket();
              setIsAuthenticated(true);
            }} />
          )}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
