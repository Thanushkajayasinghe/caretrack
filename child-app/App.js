import React, { useEffect, useState } from 'react';
import { StatusBar, View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PairScanScreen from './src/screens/Pair/PairScanScreen';
import MonitorScreen from './src/screens/Monitor/MonitorScreen';
import { Colors } from './src/theme/tokens';
import { initServerConfig } from './src/config/server';

const Stack = createNativeStackNavigator();

export default function App() {
  const [loading, setLoading] = useState(true);
  const [isPaired, setIsPaired] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkPairingStatus = async () => {
      try {
        await initServerConfig();
        const paired = await AsyncStorage.getItem('paired');
        const deviceToken = await AsyncStorage.getItem('deviceToken');

        if (isMounted) {
          // If already paired with credentials, lock into Monitor screen permanently
          if (paired === 'true' && deviceToken) {
            setIsPaired(true);
          } else {
            setIsPaired(false);
          }
        }
      } catch (err) {
        console.warn('Error reading pairing state:', err);
        if (isMounted) setIsPaired(false);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    checkPairingStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg.primary} />
        <ActivityIndicator size="large" color={Colors.brand.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg.primary} />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {isPaired ? (
              <Stack.Screen name="Monitor" component={MonitorScreen} />
            ) : (
              <Stack.Screen name="PairScan">
                {(props) => (
                  <PairScanScreen
                    {...props}
                    onPaired={() => setIsPaired(true)}
                  />
                )}
              </Stack.Screen>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: Colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

