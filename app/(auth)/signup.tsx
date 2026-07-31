import { Redirect, useLocalSearchParams } from 'expo-router';

export default function SignupScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const queryString = context ? `?context=${context}` : '';
  return <Redirect href={`/(auth)/signup-methods${queryString}`} />;
}
