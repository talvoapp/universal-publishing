/**
 * useFeed — fetch and paginate the user's feed.
 */

import { useState, useEffect, useCallback } from 'react';
import { feedApi } from '@/api/feed.api';
import { getErrorMessage } from '@/api/client';
import type { Post } from '@/types';

export function useFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else if (posts.length === 0) {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await feedApi.getMyFeed(refresh ? undefined : cursor);
      setPosts(refresh ? res.posts : [...posts, ...res.posts]);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cursor, posts]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    posts,
    loading,
    refreshing,
    error,
    hasMore,
    refresh: () => load(true),
    loadMore: () => load(false),
  };
}