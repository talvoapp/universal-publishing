/**
 * PostCard — feed item.
 */

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { formatRelative } from '@/utils/format';
import { colors } from '@/theme/colors';
import type { Post } from '@/types';

interface PostCardProps {
  post: Post;
  onPress?: () => void;
}

export function PostCard({ post, onPress }: PostCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {post.authorId.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.timestamp}>{formatRelative(post.publishedAt)}</Text>
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {post.title}
      </Text>
      <Text style={styles.excerpt} numberOfLines={3}>
        {post.excerpt}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {post.contentType.replace('_', ' ')} · {Math.ceil(post.wordCount / 200)} min read
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  cardPressed: {
    backgroundColor: colors.slate[50],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.brand[700],
  },
  timestamp: {
    fontSize: 12,
    color: colors.slate[500],
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.slate[900],
    marginBottom: 6,
    lineHeight: 24,
  },
  excerpt: {
    fontSize: 14,
    color: colors.slate[600],
    lineHeight: 20,
    marginBottom: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meta: {
    fontSize: 12,
    color: colors.slate[500],
    textTransform: 'capitalize',
  },
});