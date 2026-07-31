import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LoginScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const queryString = context ? `?context=${context}` : '';
  return <Redirect href={`/(auth)/login-methods${queryString}`} />;
}
