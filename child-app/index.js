/**
 * @format
 */

import {AppRegistry, View, Text} from 'react-native';
import {name as appName} from './app.json';

let RootComponent = null;
try {
  const App = require('./App').default;
  RootComponent = App;
} catch (e) {
  console.error('CRITICAL: Failed to load child App.js:', e);
  RootComponent = function ErrorScreen() {
    return (
      <View style={{flex: 1, backgroundColor: '#111', justifyContent: 'center', padding: 20}}>
        <Text style={{color: 'red', fontSize: 18, fontWeight: 'bold'}}>Child App Startup Error:</Text>
        <Text style={{color: '#fff', marginTop: 10}}>{String(e && e.stack ? e.stack : e)}</Text>
      </View>
    );
  };
}

AppRegistry.registerComponent(appName, () => RootComponent);
