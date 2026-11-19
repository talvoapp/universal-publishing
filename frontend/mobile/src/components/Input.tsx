
/**
 * Input — labeled text input with error display.
 */

import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { colors } from '@/theme/colors';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...rest }: Props) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      <TextInput
        style={[
          styles.input,
          error ? styles.inputError : undefined,
          style,
        ]}
        placeholderTextColor={colors.slate[400]}
        {...rest}
      />

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate[700],
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.slate[300],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.slate[900],
    backgroundColor: '#ffffff',
  },
  inputError: {
    borderColor: colors.danger[500],
  },
  error: {
    fontSize: 12,
    color: colors.danger[600],
    marginTop: 4,
  },
});
