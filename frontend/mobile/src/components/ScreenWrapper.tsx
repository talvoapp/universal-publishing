/**
 * ScreenWrapper — common layout for all screens.
 *
 * Provides:
 *   - Safe area insets
 *   - Optional scroll
 *   - Optional padding
 *   - Loading + error states
 */

import { View, ScrollView, ActivityIndicator, Text, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';

interface ScreenWrapperProps {
  children: React.ReactNode;
  scroll?: boolean;
  loading?: boolean;
  error?: string | null;
  style?: ViewStyle;
}

export function ScreenWrapper({
  children,
  scroll = false,
  loading = false,
  error = null,
  style,
}: ScreenWrapperProps) {
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand[600]} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  const content = <View style={[styles.content, style]}>{children}</View>;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  scrollContent: {
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.slate[50],
  },
  errorText: {
    fontSize: 15,
    color: colors.danger[600],
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});