/**
 * Home tab — feed.
 */

import { useEffect, useState, useCallback } from 'react';
import { FlatList, Text, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { PostCard } from '@/components/PostCard';
import { feedApi } from '@/api/feed.api';
import { getErrorMessage } from '@/api/client';
import { colors } from '@/theme/colors';
import type { Post } from '@/types';

export default function HomeScreen() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    try {
      setError(null);
      const res = await feedApi.getMyFeed();
      setPosts(res.posts);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadFeed();
  }, [loadFeed]);

  return (
    <ScreenWrapper loading={loading} error={error}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => router.push(`/editor/${item.id}`)}
          />
        )}
        ListHeaderComponent={
          <Text style={styles.header}>Your Feed</Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Your feed is empty. Follow some authors to see their posts.
          </Text>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand[600]}
          />
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.slate[900],
    marginBottom: 16,
  },
  empty: {
    textAlign: 'center',
    color: colors.slate[500],
    paddingVertical: 40,
    fontSize: 14,
  },
  list: {
    paddingBottom: 16,
  },
});