/**
 * Delete Account screen — requires password + confirmation phrase.
 */

import { useState } from 'react';
import { Text, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { clients } from '@/api/client';
import { getErrorMessage } from '@/api/client';
import { useAuthStore } from '@/store/auth.store';
import { colors } from '@/theme/colors';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [saving, setSaving] = useState(false);

  const handleDelete = () => {
    if (phrase !== 'DELETE MY ACCOUNT') {
      Alert.alert('Error', 'Please type "DELETE MY ACCOUNT" exactly');
      return;
    }
    Alert.alert(
      'Delete Account',
      'This action cannot be undone. All your data will be deleted after 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await clients.auth.delete('/api/v1/users/me', {
                data: { password, confirmPhrase: phrase },
              });
              await logout();
              Alert.alert('Account deleted', 'You have been signed out.', [
                { text: 'OK', onPress: () => router.replace('/(auth)/login') },
              ]);
            } catch (err) {
              Alert.alert('Error', getErrorMessage(err));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenWrapper scroll>
      <Text style={styles.header}>Delete Account</Text>
      <Text style={styles.warning}>
        This will permanently delete your account and all associated data after a 30-day grace period.
      </Text>

      <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry editable={!saving} />
      <Input
        label='Type "DELETE MY ACCOUNT" to confirm'
        value={phrase}
        onChangeText={setPhrase}
        autoCapitalize="characters"
        editable={!saving}
      />

      <Button title={saving ? 'Deleting…' : 'Delete Account'} onPress={handleDelete} variant="danger" loading={saving} disabled={saving} />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 24, fontWeight: '700', color: colors.slate[900], marginBottom: 12 },
  warning: { fontSize: 14, color: colors.danger[600], marginBottom: 24, lineHeight: 20 },
});