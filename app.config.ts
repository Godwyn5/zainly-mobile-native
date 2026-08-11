import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * The @react-native-google-signin/google-signin plugin is added only when
 * EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is present.  This env var must be set to
 * the reversed client ID from the Google Cloud iOS OAuth client, prefixed
 * with "com.googleusercontent.apps.".
 *
 * Without this scheme, iOS Google Sign-In cannot complete the OAuth redirect
 * back to the app.  Android does not require a plugin — GoogleSignin.configure()
 * with webClientId is sufficient.
 *
 * The plugin is NOT added when the env var is missing, so the build does not
 * fail.  Google Sign-In will return config_error at runtime in that case.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const cfg = config as ExpoConfig;

  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

  const plugins = cfg.plugins ?? [];

  if (iosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme },
    ]);
  }

  cfg.plugins = plugins;

  return cfg;
};
