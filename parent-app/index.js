import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';

AppRegistry.registerComponent('caretrack-parent', () => App);
AppRegistry.registerComponent('main', () => App);

registerRootComponent(App);

