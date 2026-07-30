import React from 'react';
import { Text, StyleSheet } from 'react-native';

// NOTE: Official Apple/Google icons require react-native-svg library
// which is not in current dependencies. Using unicode placeholder for now.
// This should be replaced with proper SVG icons when react-native-svg is added.

export default function AppleIcon({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Text style={[styles.icon, { fontSize: size, color }]}></Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontWeight: '400',
  },
});
