import { activateKeepAwakeAsync, deactivateKeepAwake as deactivateExpoKeepAwake } from 'expo-keep-awake';

export const activateKeepAwake = () => {
  try {
    activateKeepAwakeAsync();
  } catch (e) {
    console.warn('activateKeepAwake error:', e);
  }
};

export const deactivateKeepAwake = () => {
  try {
    deactivateExpoKeepAwake();
  } catch (e) {
    console.warn('deactivateKeepAwake error:', e);
  }
};

export default {
  activate: activateKeepAwake,
  deactivate: deactivateKeepAwake,
};
