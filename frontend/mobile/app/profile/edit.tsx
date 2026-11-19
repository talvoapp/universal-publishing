/**
 * Edit Profile screen — update displayName, bio, avatarUrl, language.
 */

import { useState } from 'react';
import { Text, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { userApi } from '@/api/auth.api';
import { getErrorMessage } from '@/api/client';
import { useAuthStore } from '@/store/auth.store';
import { colors } from '@/theme/colors';

export default function EditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Display name is required');
      return;
    }
    setSaving(true);
    try {
      await userApi.updateMe({
        displayName: displayName.trim(),
        bio: bio.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
      });
      await hydrate(); // refresh user in store
      Alert.alert('Saved', 'Profile updated successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.header}>Edit Profile</Text>

      <Input
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Your name"
        editable={!saving}
      />

      <Input
        label="Bio"
        value={bio}
        onChangeText={setBio}
        placeholder="Tell us about yourself"
        multiline
        numberOfLines={4}
        style={{ minHeight: 100 }}
        editable={!saving}
      />

      <Input
        label="Avatar URL (optional)"
        value={avatarUrl}
        onChangeText={setAvatarUrl}
        placeholder="https://..."
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
      />

      <Button
        title={saving ? 'Saving…' : 'Save Changes'}
        onPress={handleSave}
        loading={saving}
        disabled={saving}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 24, fontWeight: '700', color: colors.slate[900], marginBottom: 24 },
});