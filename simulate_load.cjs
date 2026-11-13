// Mock React Native and basic dependencies
require('@babel/register')({
  presets: ['module:@react-native/babel-preset'],
  ignore: [/node_modules\/(?!(@react-navigation|react-native-image-picker)\/)/],
});

const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'react-native') {
    return {
      Platform: { OS: 'android', select: (obj) => obj.android || obj.default },
      StyleSheet: { create: (styles) => styles, absoluteFill: {}, absoluteFillObject: {} },
      Dimensions: { get: () => ({ width: 400, height: 800 }) },
      Animated: { Value: function() { return { interpolate: () => ({}) }; }, timing: () => ({ start: () => {} }), loop: () => ({ start: () => {} }), sequence: () => ({ start: () => {} }) },
      View: 'View',
      Text: 'Text',
      TouchableOpacity: 'TouchableOpacity',
      TextInput: 'TextInput',
      ScrollView: 'ScrollView',
      ActivityIndicator: 'ActivityIndicator',
      Image: 'Image',
      StatusBar: 'StatusBar',
      Alert: { alert: () => {} },
      DeviceEventEmitter: { addListener: () => ({ remove: () => {} }) },
      AppState: { addEventListener: () => ({ remove: () => {} }) },
      NativeModules: {},
      PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {} },
    };
  }
  if (id === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' };
  if (id === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider' };
  if (id === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  if (id === 'react-native-linear-gradient') return 'LinearGradient';
  if (id === 'react-native-vector-icons/Ionicons') return 'Icon';
  if (id === 'react-native-qrcode-svg') return 'QRCode';
  if (id === 'react-native-webview') return { WebView: 'WebView' };
  if (id === '@react-native-community/slider') return 'Slider';
  if (id === 'socket.io-client') return () => ({ on: () => {}, off: () => {}, emit: () => {} });
  if (id === 'react-native-image-picker') return { launchImageLibrary: async () => ({}), launchCamera: async () => ({}) };
  return origRequire.apply(this, arguments);
};

try {
  console.log('Loading MainNavigator...');
  const mainNav = require('./parent-app/src/navigation/MainNavigator');
  console.log('MainNavigator loaded successfully:', typeof mainNav.MainNavigator);
  console.log('Keys in mainNav:', Object.keys(mainNav));
} catch (err) {
  console.error('FAILED TO LOAD MainNavigator:', err);
}

try {
  console.log('\nLoading App...');
  const app = require('./parent-app/App');
  console.log('App loaded successfully:', typeof app.default);
} catch (err) {
  console.error('FAILED TO LOAD App:', err);
}
