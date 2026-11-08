/**
 * Feed page — infinite scroll feed of published posts.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { feedApi } from '@/api/feed.api';
import { PostCard } from '@/components/Feed/PostCard';
import { Loader } from '@/components/common/Loader';
import { showToast } from '@/components/common/Toast';
import type { Post } from '@/types';

export function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await feedApi.getMyFeed(cursor, 20);
      setPosts((prev) => [...prev, ...res.posts]);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch {
      showToast.error('Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading]);

  // Initial load
  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          void loadMore();
        }
      },
      { threshold: 1.0 },
    );
    const target = observerTarget.current;
    if (target) observer.observe(target);
    return () => {
      if (target) observer.unobserve(target);
    };
  }, [loadMore, hasMore, loading]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Your Feed</h1>
        <p className="text-slate-600 mt-1">Latest from authors you follow</p>
      </div>

      {posts.length === 0 && !loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <h3 className="font-semibold text-slate-900 mb-2">Your feed is empty</h3>
          <p className="text-sm text-slate-600">Follow some authors to see their posts here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {/* Infinite scroll trigger */}
      <div ref={observerTarget} className="h-10" />

      {loading && <Loader label="Loading more…" />}
      {!hasMore && posts.length > 0 && (
        <div className="text-center text-sm text-slate-500 py-4">You're all caught up!</div>
      )}
    </div>
  );
}