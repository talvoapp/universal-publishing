/**
 * Wallet tab — balance + payout.
 */

import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl, ScrollView, Alert, TextInput } from 'react-native';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { walletApi } from '@/api/wallet.api';
import { getErrorMessage } from '@/api/client';
import { formatCurrency } from '@/utils/format';
import { colors } from '@/theme/colors';
import type { WalletSummary } from '@/types';

export default function WalletScreen() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [requesting, setRequesting] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      setError(null);
      const data = await walletApi.getSummary();
      setWallet(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const handlePayout = async () => {
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents < 1000) {
      Alert.alert('Error', 'Minimum payout is $10.00');
      return;
    }
    setRequesting(true);
    try {
      await walletApi.requestPayout(amountCents, wallet?.currency || 'USD');
      Alert.alert('Success', 'Payout requested');
      setAmount('');
      void loadWallet();
    } catch (err) {
      Alert.alert('Payout failed', getErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <ScreenWrapper loading={loading} error={error}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadWallet();
            }}
            tintColor={colors.brand[600]}
          />
        }
      >
        <Text style={styles.header}>Wallet</Text>

        {wallet && (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available</Text>
              <Text style={styles.balanceValue}>
                {formatCurrency(wallet.available, wallet.currency)}
              </Text>
              <View style={styles.stats}>
                <View>
                  <Text style={styles.statLabel}>Lifetime</Text>
                  <Text style={styles.statValue}>
                    {formatCurrency(wallet.lifetime, wallet.currency)}
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Paid out</Text>
                  <Text style={styles.statValue}>
                    {formatCurrency(wallet.paidOut, wallet.currency)}
                  </Text>
                </View>
              </View>
            </View>

            {wallet.connectStatus === 'active' ? (
              <View style={styles.payoutCard}>
                <Text style={styles.payoutTitle}>Request payout</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  editable={!requesting}
                />
                <Pressable
                  style={[styles.button, requesting && styles.buttonDisabled]}
                  onPress={handlePayout}
                  disabled={requesting}
                >
                  <Text style={styles.buttonText}>
                    {requesting ? 'Requesting…' : 'Request Payout'}
                  </Text>
                </Pressable>
                <Text style={styles.hint}>Minimum $10.00 · Arrives in 2–7 business days</Text>
              </View>
            ) : (
              <View style={styles.warningCard}>
                <Text style={styles.warningTitle}>Complete Stripe onboarding</Text>
                <Text style={styles.warningText}>
                  Set up your Connect account to receive payouts. Please log in on the web to
                  complete onboarding.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
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
  balanceCard: {
    backgroundColor: colors.brand[600],
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  balanceLabel: { fontSize: 13, color: colors.brand[100], marginBottom: 4 },
  balanceValue: { fontSize: 32, fontWeight: '700', color: '#ffffff', marginBottom: 16 },
  stats: { flexDirection: 'row', gap: 24, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 12 },
  statLabel: { fontSize: 11, color: colors.brand[100], marginBottom: 2 },
  statValue: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  payoutCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.slate[200],
    marginBottom: 16,
  },
  payoutTitle: { fontSize: 16, fontWeight: '600', color: colors.slate[900], marginBottom: 12 },
  amountInput: {
    borderWidth: 1,
    borderColor: colors.slate[300],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
    color: colors.slate[900],
  },
  button: {
    backgroundColor: colors.brand[600],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 11, color: colors.slate[500], textAlign: 'center', marginTop: 8 },
  warningCard: {
    backgroundColor: colors.warning[50],
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  warningTitle: { fontSize: 15, fontWeight: '600', color: '#92400e', marginBottom: 6 },
  warningText: { fontSize: 13, color: '#78350f', lineHeight: 18 },
});