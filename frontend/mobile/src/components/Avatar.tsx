/**
 * Avatar — displays user initials or image.
 */

import { View, Image, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';
import { initials } from '@/utils/format';

interface Props {
  name: string;
  imageUrl?: string | null;
  size?: number;
}

export function Avatar({ name, imageUrl, size = 40 }: Props) {
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.35 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.slate[200],
  },
  fallback: {
    backgroundColor: colors.brand[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '700',
    color: colors.brand[700],
  },
});