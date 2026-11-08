/**
 * Marketplace tab — browse items.
 */

import { useEffect, useState, useCallback } from 'react';
import { FlatList, Text, Pressable, RefreshControl, StyleSheet, Image, Linking, Alert } from 'react-native';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { marketplaceApi } from '@/api/marketplace.api';
import { getErrorMessage } from '@/api/client';
import { formatCurrency, formatNumber } from '@/utils/format';
import { colors } from '@/theme/colors';
import type { Item } from '@/types';

export default function MarketplaceScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setError(null);
      const { items: data } = await marketplaceApi.listItems({ limit: 30 });
      setItems(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handlePurchase = async (item: Item) => {
    try {
      const res = await marketplaceApi.initiateCheckout({
        itemId: item.id,
        successUrl: 'upp://checkout/success',
        cancelUrl: 'upp://checkout/cancel',
      });
      // Open Stripe checkout in browser
      const supported = await Linking.canOpenURL(res.checkout_url);
      if (supported) {
        await Linking.openURL(res.checkout_url);
      } else {
        Alert.alert('Error', 'Cannot open checkout URL');
      }
    } catch (err) {
      Alert.alert('Checkout failed', getErrorMessage(err));
    }
  };

  return (
    <ScreenWrapper loading={loading} error={error}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => handlePurchase(item)}>
            <View style={styles.cover}>
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.coverImage} />
              ) : (
                <Text style={styles.coverTitle} numberOfLines={3}>{item.title}</Text>
              )}
            </View>
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            <View style={styles.footer}>
              <Text style={styles.price}>
                {item.priceCents === 0 ? 'Free' : formatCurrency(item.priceCents / 100, item.currency)}
              </Text>
              <Text style={styles.words}>{formatNumber(item.wordCount)}w</Text>
            </View>
          </Pressable>
        )}
        ListHeaderComponent={<Text style={styles.header}>Discover</Text>}
        ListEmptyComponent={
          <Text style={styles.empty}>No items available yet.</Text>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadItems();
            }}
            tintColor={colors.brand[600]}
          />
        }
        contentContainerStyle={styles.list}
      />
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
  row: {
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.slate[200],
    overflow: 'hidden',
    marginBottom: 12,
  },
  cover: {
    aspectRatio: 2 / 3,
    backgroundColor: colors.brand[600],
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate[900],
    paddingHorizontal: 10,
    paddingTop: 10,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  price: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.brand[700],
  },
  words: {
    fontSize: 11,
    color: colors.slate[500],
  },
  empty: {
    textAlign: 'center',
    color: colors.slate[500],
    paddingVertical: 40,
    fontSize: 14,
  },
  list: {
    paddingBottom: 16,
  },
});