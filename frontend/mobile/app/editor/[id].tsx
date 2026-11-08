/**
 * Editor screen — simple TextInput editor (v1).
 *
 * v2 will integrate a rich text editor (e.g., @10play/tentap-editor).
 * For v1, we use a plain TextInput with autosave + word count.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { editorApi } from '@/api/editor.api';
import { getErrorMessage } from '@/api/client';
import { colors } from '@/theme/colors';
import type { Draft } from '@/types';

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const { draft } = await editorApi.getDraft(id);
        setDraft(draft);
        setTitle(draft.title);
        setContent(draft.content);
      } catch (err) {
        Alert.alert('Error', getErrorMessage(err));
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await editorApi.updateDraft(draft.id, { title });
      Alert.alert('Saved', 'Draft updated');
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [draft, title]);

  const handlePublish = async () => {
    if (!draft) return;
    Alert.alert('Publish', 'Are you ready to publish?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Publish',
        onPress: async () => {
          try {
            await editorApi.publishDraft(draft.id);
            Alert.alert('Published!', 'Your work is now live.');
            router.back();
          } catch (err) {
            Alert.alert('Publish failed', getErrorMessage(err));
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <ScreenWrapper loading>
        <></>
      </ScreenWrapper>
    );
  }

  if (!draft) return null;

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <ScreenWrapper>
      <ScrollView>
        {/* Title */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Untitled"
          placeholderTextColor={colors.slate[400]}
        />

        {/* Content */}
        <TextInput
          style={styles.contentInput}
          value={content}
          onChangeText={setContent}
          placeholder="Start writing…"
          placeholderTextColor={colors.slate[400]}
          multiline
          textAlignVertical="top"
        />

        {/* Meta */}
        <Text style={styles.meta}>
          {wordCount} words · {Math.max(1, Math.ceil(wordCount / 200))} min read
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.buttonSecondary, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.slate[700]} />
            ) : (
              <Text style={styles.buttonSecondaryText}>Save</Text>
            )}
          </Pressable>
          <Pressable style={styles.buttonPrimary} onPress={handlePublish}>
            <Text style={styles.buttonPrimaryText}>Publish</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  titleInput: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.slate[900],
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
    marginBottom: 16,
  },
  contentInput: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.slate[800],
    minHeight: 300,
    paddingVertical: 8,
    marginBottom: 16,
  },
  meta: {
    fontSize: 12,
    color: colors.slate[500],
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: colors.brand[600],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  buttonSecondary: {
    flex: 1,
    backgroundColor: colors.slate[100],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: colors.slate[700], fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
});