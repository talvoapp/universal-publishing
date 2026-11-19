/**
 * Profile tab — user info + navigation to edit/settings.
 */

import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/store/auth.store';
import { formatDate } from '@/utils/format';
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

        {/* Avatar + Name */}
        <View style={styles.avatarCard}>
          <Avatar name={user.displayName} imageUrl={user.avatarUrl} size={80} />
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.role}>{user.role}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionGroup}>
          <Pressable
            style={styles.actionRow}
            onPress={() => router.push('/profile/edit')}
          >
            <Ionicons name="person-outline" size={22} color={colors.slate[700]} />
            <Text style={styles.actionLabel}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={styles.actionRow}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.slate[700]} />
            <Text style={styles.actionLabel}>Settings</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={styles.actionRow}
            onPress={() => router.push('/wallet/connect')}
          >
            <Ionicons name="card-outline" size={22} color={colors.slate[700]} />
            <Text style={styles.actionLabel}>Connect Stripe Account</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
          </Pressable>
        </View>

        {/* Info */}
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

        {/* Logout */}
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>v1.0.0</Text>
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
  name: { fontSize: 20, fontWeight: '700', color: colors.slate[900], marginTop: 12, marginBottom: 4 },
  role: { fontSize: 13, color: colors.slate[500], textTransform: 'capitalize', marginBottom: 4 },
  email: { fontSize: 13, color: colors.slate[600] },
  actionGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.slate[200],
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  actionLabel: { flex: 1, fontSize: 15, color: colors.slate[800], fontWeight: '500' },
  divider: { height: 1, backgroundColor: colors.slate[200] },
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
  logoutButton: {
    backgroundColor: colors.danger[50],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger[500],
  },
  logoutText: { color: colors.danger[600], fontSize: 15, fontWeight: '600' },
  version: { textAlign: 'center', fontSize: 12, color: colors.slate[400], marginTop: 16, marginBottom: 8 },
});