/**
 * Drafts tab — list of user's drafts + create new.
 */

import { useEffect, useState, useCallback } from 'react';
import { FlatList, Text, Pressable, RefreshControl, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { editorApi } from '@/api/editor.api';
import { getErrorMessage } from '@/api/client';
import { formatRelative } from '@/utils/format';
import { colors } from '@/theme/colors';
import type { DraftSummary } from '@/types';

export default function DraftsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    try {
      setError(null);
      const { data } = await editorApi.listDrafts({ limit: 50 });
      setDrafts(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleCreate = async () => {
    try {
      const { draft } = await editorApi.createDraft({ contentType: 'article' });
      router.push(`/editor/${draft.id}`);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    }
  };

  return (
    <ScreenWrapper loading={loading} error={error}>
      <FlatList
        data={drafts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/editor/${item.id}`)}
          >
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.status} · {formatRelative(item.updatedAt)}
            </Text>
          </Pressable>
        )}
        ListHeaderComponent={
          <Text style={styles.header}>My Drafts</Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No drafts yet. Tap + to create one.</Text>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadDrafts();
            }}
            tintColor={colors.brand[600]}
          />
        }
        contentContainerStyle={styles.list}
      />

      {/* Floating action button */}
      <Pressable style={styles.fab} onPress={handleCreate}>
        <Ionicons name="add" size={28} color="#ffffff" />
      </Pressable>
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.slate[900],
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: colors.slate[500],
    textTransform: 'capitalize',
  },
  empty: {
    textAlign: 'center',
    color: colors.slate[500],
    paddingVertical: 40,
    fontSize: 14,
  },
  list: {
    paddingBottom: 80,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
});