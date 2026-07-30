import React from 'react';
import { Text, StyleSheet } from 'react-native';

// NOTE: Premium email icon (SF Symbols style) requires react-native-svg library
// which is not in current dependencies. Using unicode envelope for now.
// This should be replaced with proper SVG icon when react-native-svg is added.

export default function EmailIcon({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Text style={[styles.icon, { fontSize: size, color }]}>✉</Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontWeight: '400',
  },
});
