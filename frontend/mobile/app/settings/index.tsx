/**
 * Settings screen — app-level settings.
 */

import { View, Text, Pressable, ScrollView, StyleSheet, Alert, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { useAuthStore } from '@/store/auth.store';
import { colors } from '@/theme/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

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

  return (
    <ScreenWrapper scroll>
      <Text style={styles.header}>Settings</Text>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Push notifications</Text>
          <Switch
            value={notificationsEnabled}
            onValueChange={setNotificationsEnabled}
            trackColor={{ true: colors.brand[600], false: colors.slate[300] }}
          />
        </View>
      </View>

      {/* Appearance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Dark mode</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ true: colors.brand[600], false: colors.slate[300] }}
          />
        </View>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <Pressable
          style={styles.row}
          onPress={() => router.push('/settings/change-password')}
        >
          <Text style={styles.rowLabel}>Change password</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
        </Pressable>

        <Pressable
          style={styles.row}
          onPress={() => router.push('/settings/delete-account')}
        >
          <Text style={[styles.rowLabel, styles.danger]}>Delete account</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.danger[500]} />
        </Pressable>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.slate[400]} />
        </View>
      </View>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 24, fontWeight: '700', color: colors.slate[900], marginBottom: 24 },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.slate[200],
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate[500],
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.slate[100],
  },
  rowLabel: { fontSize: 15, color: colors.slate[800] },
  rowValue: { fontSize: 15, color: colors.slate[500] },
  danger: { color: colors.danger[600] },
  logoutButton: {
    backgroundColor: colors.danger[50],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger[500],
    marginTop: 8,
  },
  logoutText: { color: colors.danger[600], fontSize: 15, fontWeight: '600' },
});