/**
 * Change Password screen.
 */

import { useState } from 'react';
import { Text, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { clients } from '@/api/client';
import { getErrorMessage } from '@/api/client';
import { colors } from '@/theme/colors';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!current || !next || !confirm) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (next.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }
    if (next !== confirm) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await clients.auth.post('/api/v1/users/me/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      Alert.alert('Success', 'Password changed. Please sign in again.', [
        { text: 'OK', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.header}>Change Password</Text>

      <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry editable={!saving} />
      <Input label="New password" value={next} onChangeText={setNext} secureTextEntry editable={!saving} />
      <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry editable={!saving} />

      <Button title={saving ? 'Saving…' : 'Change Password'} onPress={handleSave} loading={saving} disabled={saving} />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 24, fontWeight: '700', color: colors.slate[900], marginBottom: 24 },
});