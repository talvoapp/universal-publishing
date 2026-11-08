/**
 * Profile tab — user info + logout.
 */

import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { useAuthStore } from '@/store/auth.store';
import { initials, formatDate } from '@/utils/format';
import { colors } from '@/theme/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  if (!user) return null;

  return (
    <ScreenWrapper>
      <ScrollView>
        <Text style={styles.header}>Profile</Text>

        <View style={styles.avatarCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user.displayName)}</Text>
          </View>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.role}>{user.role}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Member since</Text>
            <Text style={styles.infoValue}>{formatDate(user.createdAt)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email verified</Text>
            <Text style={[styles.infoValue, user.emailVerified ? styles.verified : styles.notVerified]}>
              {user.emailVerified ? 'Yes' : 'No'}
            </Text>
          </View>
        </View>

        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 24, fontWeight: '700', color: colors.slate[900], marginBottom: 16 },
  avatarCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.brand[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: colors.brand[700] },
  name: { fontSize: 20, fontWeight: '700', color: colors.slate[900], marginBottom: 4 },
  role: { fontSize: 13, color: colors.slate[500], textTransform: 'capitalize', marginBottom: 4 },
  email: { fontSize: 13, color: colors.slate[600] },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { fontSize: 14, color: colors.slate[600] },
  infoValue: { fontSize: 14, fontWeight: '500', color: colors.slate[900] },
  verified: { color: colors.success[600] },
  notVerified: { color: colors.warning[600] },
  divider: { height: 1, backgroundColor: colors.slate[200] },
  logoutButton: {
    backgroundColor: colors.danger[50],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger[500],
  },
  logoutText: { color: colors.danger[600], fontSize: 15, fontWeight: '600' },
});