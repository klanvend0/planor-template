import Superwall from '@superwall/react-native-superwall';

export const configureSuperwall = () => {
  const apiKey = process.env.EXPO_PUBLIC_SUPERWALL_API_KEY;
  if (apiKey) {
    Superwall.configure({ apiKey });
  } else {
    console.warn('Superwall API key not found');
  }
};
