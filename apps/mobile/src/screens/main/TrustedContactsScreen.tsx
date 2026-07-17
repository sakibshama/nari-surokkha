import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { UserMinus, UserPlus, Users, Phone, Heart, ChevronLeft } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../services/api';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows, gradients } from '../../theme';
import { useNavigation } from '@react-navigation/native';

interface Contact { id: string; name: string; phone: string; relation: string; }

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#f43f5e'];
const getColor = (name: string) => AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

export default function TrustedContactsScreen() {
  const navigation = useNavigation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [focusedField, setFocusedField] = useState('');

  const fetch = async () => {
    try {
      const res = await api.get('/contacts');
      const data = res.data.data;
      setContacts(data);
      await AsyncStorage.setItem('@trusted_contacts', JSON.stringify(data));
    } catch (e) {
      console.error(e);
      // Fallback to offline cache
      try {
        const cached = await AsyncStorage.getItem('@trusted_contacts');
        if (cached) setContacts(JSON.parse(cached));
      } catch (err) {}
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const addContact = async () => {
    if (!name || !phone) { Alert.alert('Required', 'Name and phone are required.'); return; }
    
    // Ensure phone has +88 prefix for Bangladeshi numbers
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) {
      formattedPhone = `+88${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+880${formattedPhone}`;
    }

    setAdding(true);
    try {
      await api.post('/contacts', { name, phone: formattedPhone, relation });
      setName(''); setPhone(''); setRelation('');
      fetch();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error?.message || 'Failed to add contact');
    } finally { setAdding(false); }
  };

  const removeContact = (id: string) => {
    Alert.alert('Remove Contact', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { try { await api.delete(`/contacts/${id}`); fetch(); } catch { Alert.alert('Error', 'Failed.'); } } }
    ]);
  };

  const renderContact = ({ item }: { item: Contact }) => {
    const ac = getColor(item.name);
    return (
      <View style={styles.contactCard}>
        <View style={[styles.avatar, { backgroundColor: `${ac}20`, borderColor: `${ac}50` }]}>
          <Text style={[styles.avatarText, { color: ac }]}>{getInitials(item.name)}</Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{item.name}</Text>
          <View style={styles.contactMeta}>
            <Phone color={colors.textMuted} size={12} />
            <Text style={styles.contactPhone}>{item.phone}</Text>
          </View>
          {!!item.relation && (
            <View style={[styles.relationTag, { borderColor: `${ac}50`, backgroundColor: `${ac}15` }]}>
              <Heart color={ac} size={10} />
              <Text style={[styles.relationText, { color: ac }]}>{item.relation}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => removeContact(item.id)} style={styles.removeBtn} activeOpacity={0.7}>
          <UserMinus color={colors.primary} size={20} />
        </TouchableOpacity>
      </View>
    );
  };

  const fStyle = (id: string) => [styles.inputRow, focusedField === id && styles.inputFocused];

  return (
    <LinearGradient colors={['#060d1f', '#0a1428', '#0d1b35']} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.navHeader}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn} activeOpacity={0.7}>
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Trusted Contacts</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Add Form */}
        <View style={styles.addSection}>
          <View style={styles.addHeader}>
            <UserPlus color={colors.blue} size={20} />
            <Text style={styles.addTitle}>Add Trusted Contact</Text>
          </View>

          <View style={fStyle('name')}>
            <TextInput style={styles.input} placeholder="Full Name *" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName}
              onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField('')} />
          </View>
          <View style={fStyle('phone')}>
            <TextInput style={styles.input} placeholder="Phone Number *" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone}
              onFocus={() => setFocusedField('phone')} onBlur={() => setFocusedField('')} />
          </View>
          <View style={[fStyle('relation'), { marginBottom: 0 }]}>
            <TextInput style={styles.input} placeholder="Relation (e.g. Sister, Mother)" placeholderTextColor={colors.textMuted} value={relation} onChangeText={setRelation}
              onFocus={() => setFocusedField('relation')} onBlur={() => setFocusedField('')} />
          </View>

          <TouchableOpacity onPress={addContact} disabled={adding} activeOpacity={0.85} style={styles.addBtnWrapper}>
            <LinearGradient colors={gradients.blue} style={styles.addBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {adding
                ? <ActivityIndicator color="#fff" />
                : <>
                    <UserPlus color="#fff" size={18} />
                    <Text style={styles.addBtnText}>Add Contact</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* List Header */}
        <View style={styles.listHeader}>
          <Users color={colors.textMuted} size={16} />
          <Text style={styles.listHeaderText}>Your Trusted Contacts</Text>
          {!loading && (
            <View style={[styles.countBadge, { backgroundColor: contacts.length > 0 ? colors.primary : colors.bgCard }]}>
              <Text style={styles.countText}>{contacts.length}</Text>
            </View>
          )}
        </View>

        {loading
          ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
          : (
            <FlatList
              data={contacts}
              keyExtractor={i => i.id}
              renderItem={renderContact}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Users color={colors.border} size={56} />
                  <Text style={styles.emptyTitle}>No contacts yet</Text>
                  <Text style={styles.emptySub}>Add people who will be alerted in an emergency. They'll receive your live location via SMS.</Text>
                </View>
              }
            />
          )
        }
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  navHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(6,13,31,0.98)',
    borderBottomWidth: 1, borderBottomColor: colors.glassBorder,
  },
  navBackBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { ...font.h3, color: colors.text },
  addSection: {
    backgroundColor: colors.bgCard,
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  addHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  addTitle: { ...font.h3, color: colors.text },
  inputRow: {
    backgroundColor: colors.bgInput, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.border, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
  },
  inputFocused: { borderColor: colors.blue, backgroundColor: 'rgba(59,130,246,0.06)' },
  input: { ...font.body, color: colors.text, height: 36 },
  addBtnWrapper: { marginTop: spacing.sm, borderRadius: radius.lg, ...shadows.blue },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  addBtnText: { ...font.h3, color: '#fff' },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  listHeaderText: { ...font.label, flex: 1 },
  countBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  countText: { ...font.xs, color: '#fff', fontWeight: '700' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.glassBorder, ...shadows.card },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  avatarText: { fontSize: 17, fontWeight: 'bold' },
  contactInfo: { flex: 1 },
  contactName: { ...font.body, color: colors.text, fontWeight: '700' },
  contactMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  contactPhone: { ...font.sm, color: colors.textMuted },
  relationTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 5 },
  relationText: { fontSize: 11, fontWeight: '700' },
  removeBtn: { padding: spacing.sm, backgroundColor: `${colors.primary}15`, borderRadius: radius.sm },
  empty: { alignItems: 'center', paddingTop: spacing.xxl + spacing.xl, paddingHorizontal: spacing.xl },
  emptyTitle: { ...font.h3, color: colors.textMuted, marginTop: spacing.lg },
  emptySub: { ...font.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginTop: spacing.sm },
});
