/**
 * LoadingSpinner — centered spinner with optional label.
 */

import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';

interface Props {
  label?: string;
  size?: 'small' | 'large';
}

export function LoadingSpinner({ label, size = 'large' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={colors.brand[600]} />
      {label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    color: colors.slate[600],
  },
});