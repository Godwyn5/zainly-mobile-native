import React from 'react';
import { Text, StyleSheet } from 'react-native';

// NOTE: Official Google G icon requires react-native-svg library
// which is not in current dependencies. Using unicode placeholder for now.
// This should be replaced with proper SVG icon when react-native-svg is added.

export default function GoogleIcon({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Text style={[styles.icon, { fontSize: size, color }]}>G</Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontWeight: '600',
  },
});
