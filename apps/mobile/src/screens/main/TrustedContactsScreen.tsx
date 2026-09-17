import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { showAlert } from '../../utils/notify';
import Animated, { FadeInDown, FadeOutLeft, LinearTransition } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertCircle, Heart, Phone, RefreshCw, User, UserMinus, UserPlus, Users } from 'lucide-react-native';

import api from '../../services/api';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import {
  AppBar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PressableScale,
  Screen,
  SectionLabel,
  Shimmer,
  Txt,
} from '../../components/ui';

interface Contact { id: string; name: string; phone: string; relation: string }

const MAX_CONTACTS = 5;

/** Deterministic avatar tint, drawn from the palette so it follows the theme. */
const getColor = (name: string, colors: Palette) => {
  const wheel = [colors.accent, colors.info, colors.success, colors.warning, colors.accentText, colors.infoText];
  return wheel[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % wheel.length];
};
const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

export default function TrustedContactsScreen() {
  const { colors, shadows } = useTheme();
  const t = useT();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/contacts');
      const data: Contact[] = res.data?.data ?? [];
      setContacts(data);
      setFromCache(false);
      await AsyncStorage.setItem('@trusted_contacts', JSON.stringify(data));
    } catch (e: any) {
      // Say WHY. An empty list that is really a failed request is how someone
      // ends up believing their contacts are saved when they are not.
      const status = e?.response?.status;
      const msg = e?.response?.data?.error?.message;
      if (__DEV__) console.error('[contacts] load failed', status, msg || e?.message);
      setError(
        msg
          ? `${msg}${status ? ` (${status})` : ''}`
          : status
            ? `HTTP ${status}`
            : e?.message || 'Request failed',
      );

      // Offline: fall back to the cached list, and label it as cached.
      try {
        const cached = await AsyncStorage.getItem('@trusted_contacts');
        if (cached) {
          setContacts(JSON.parse(cached));
          setFromCache(true);
        }
      } catch {
        /* nothing cached */
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the screen comes into focus, so a contact added elsewhere
  // (or after the server came back) shows up without a restart.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const addContact = async () => {
    if (!name.trim() || !phone.trim()) {
      showAlert(t('Required'), t('Name and phone are required.'));
      return;
    }
    // Bangladeshi numbers need the +88 prefix.
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) formattedPhone = `+88${formattedPhone}`;
    else if (!formattedPhone.startsWith('+')) formattedPhone = `+880${formattedPhone}`;

    setAdding(true);
    try {
      await api.post('/contacts', { name: name.trim(), phone: formattedPhone, relation: relation.trim() });
      setName('');
      setPhone('');
      setRelation('');
      load();
    } catch (e: any) {
      showAlert(t('Error'), e.response?.data?.error?.message || t('Failed to add contact'));
    } finally {
      setAdding(false);
    }
  };

  const removeContact = (id: string) => {
    showAlert(t('Remove contact'), t('Are you sure?'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/contacts/${id}`);
            load();
          } catch {
            showAlert(t('Error'), t('Failed.'));
          }
        },
      },
    ]);
  };

  const full = contacts.length >= MAX_CONTACTS;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen>
        <AppBar
          title={t('Trusted Contacts')}
          subtitle={t('They get an SMS with your live location when you press SOS.')}
        />

        {/* Add form */}
        <Card elevation="raised" delay={40}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
            <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <UserPlus color={colors.accent} size={18} />
            </View>
            <Txt variant="h3" style={{ flex: 1 }}>{t('Add trusted contact')}</Txt>
            <Badge
              label={t('{n} of {max}', { n: contacts.length, max: MAX_CONTACTS })}
              tone={full ? 'warning' : 'accent'}
            />
          </View>

          <Field
            placeholder={t('Full name *')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            icon={(c) => <User size={17} color={c} />}
          />
          <Field
            placeholder={t('Phone number *')}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            icon={(c) => <Phone size={17} color={c} />}
          />
          <Field
            placeholder={t('Relation (e.g. Sister, Mother)')}
            value={relation}
            onChangeText={setRelation}
            icon={(c) => <Heart size={17} color={c} />}
          />
          <Button
            label={full ? t('Contact limit reached') : t('Add contact')}
            onPress={addContact}
            loading={adding}
            disabled={full}
            icon={<UserPlus color={colors.onAccent} size={18} />}
          />
        </Card>

        <SectionLabel>{t('Your trusted contacts')}</SectionLabel>

        {error && (
          <Card tone="danger" delay={60} style={{ marginBottom: spacing.sm, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <AlertCircle color={colors.dangerText} size={18} />
              <View style={{ flex: 1 }}>
                <Txt variant="smStrong" style={{ color: colors.dangerText }}>
                  {fromCache ? t('Showing your saved copy') : t('Could not load your contacts')}
                </Txt>
                <Txt variant="xs" tone="sub">{error}</Txt>
              </View>
            </View>
            <Button label={t('Try again')} variant="subtle" onPress={load} icon={<RefreshCw size={16} color={colors.text} />} />
          </Card>
        )}

        {loading ? (
          <View style={{ gap: spacing.sm }}>
            {[0, 1].map((i) => (
              <Shimmer key={i} width="100%" height={76} radius={radius.lg} />
            ))}
          </View>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={<Users color={colors.textMuted} size={30} />}
            title={t('No contacts yet')}
            message={t("Add people who will be alerted in an emergency. They'll receive your live location via SMS.")}
          />
        ) : (
          contacts.map((item, index) => {
            const ac = getColor(item.name, colors);
            return (
              <Animated.View
                key={item.id}
                entering={FadeInDown.delay(index * 60).duration(360)}
                exiting={FadeOutLeft.duration(250)}
                layout={LinearTransition.springify().damping(18)}
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                  shadows.soft,
                ]}
              >
                <View
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    borderWidth: 1.5,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${ac}20`,
                    borderColor: `${ac}55`,
                  }}
                >
                  <Text style={{ fontSize: 17, fontWeight: '800', color: ac }}>{getInitials(item.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>{item.name}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Phone color={colors.textMuted} size={12} />
                    <Text style={[type.sm, { color: colors.textMuted }]}>{item.phone}</Text>
                  </View>
                  {!!item.relation && (
                    <Badge
                      label={item.relation}
                      tone="accent"
                      icon={<Heart color={colors.accentText} size={10} />}
                      style={{ marginTop: 6 }}
                    />
                  )}
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t('Remove contact')}
                  onPress={() => removeContact(item.id)}
                  style={{ padding: spacing.sm + 2, backgroundColor: colors.dangerSoft, borderRadius: radius.md }}
                >
                  <UserMinus color={colors.dangerText} size={19} />
                </PressableScale>
              </Animated.View>
            );
          })
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
