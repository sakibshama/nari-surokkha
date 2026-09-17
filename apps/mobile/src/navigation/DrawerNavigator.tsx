import React, { useEffect } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
  useDrawerStatus,
} from '@react-navigation/drawer';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Archive,
  FileText,
  Home,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Navigation,
  PhoneCall,
  Settings,
  Shield,
  ShieldAlert,
  Timer,
  User,
  Users,
} from 'lucide-react-native';

import MainStack from './MainStack';
import { Theme, useTheme, useThemedStyles } from '../theme';
import { radius, spacing, type } from '../theme/tokens';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';
import api from '../services/api';
import LanguageToggle from '../components/LanguageToggle';
import ThemeToggle from '../components/ThemeToggle';
import { PressableScale } from '../components/ui/motion';

const Drawer = createDrawerNavigator();

type Item = {
  key: string;
  label: string;
  icon: React.ComponentType<{ color: string; size: number }>;
  screen?: string;
  params?: object;
};

const PRIMARY: Item[] = [
  { key: 'home', label: 'Home', icon: Home, screen: 'Home' },
  { key: 'contacts', label: 'Trusted Contacts', icon: Users, screen: 'TrustedContacts' },
  { key: 'profile', label: 'Profile', icon: User, screen: 'ProfileSetup' },
  { key: 'settings', label: 'Settings', icon: Settings, screen: 'Settings' },
];

const SAFETY: Item[] = [
  { key: 'route', label: 'Safe Route', icon: Navigation, screen: 'SafeRoute' },
  { key: 'map', label: 'Safety Map', icon: MapIcon, screen: 'SafetyMap' },
  { key: 'silent', label: 'Silent Alert', icon: Timer, screen: 'SoftAlert', params: { manual: true } },
  { key: 'fake', label: 'Fake Call', icon: PhoneCall, screen: 'FakeCall' },
  { key: 'report', label: 'Report Incident', icon: FileText, screen: 'ReportIncident' },
  { key: 'responder', label: 'Responder Hub', icon: ShieldAlert, screen: 'ResponderHub' },
];

const RECORDS: Item[] = [
  { key: 'sms', label: 'SOS SMS History', icon: MessageSquare, screen: 'SmsHistory' },
  { key: 'evidence', label: 'Evidence Library', icon: Archive, screen: 'EvidenceLibrary' },
];

function activeScreen(props: DrawerContentComponentProps): string {
  const main = props.state.routes[props.state.index];
  const nested = main.state as { index?: number; routes?: { name: string }[] } | undefined;
  if (nested?.routes && typeof nested.index === 'number') return nested.routes[nested.index].name;
  return 'Home';
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients } = useTheme();
  const t = useT();
  const { user, updateUser, logout } = useAuthStore();
  const isOpen = useDrawerStatus() === 'open';
  const current = activeScreen(props);

  // Refresh profile from the server so the name is always current.
  useEffect(() => {
    api
      .get('/profile')
      .then((res) => {
        const profile = res.data?.data?.profile;
        if (profile?.fullName) {
          updateUser({ profile: { fullName: profile.fullName, bloodGroup: profile.bloodGroup } });
        }
      })
      .catch(() => {});
  }, [updateUser]);

  const roleKey = typeof user?.role === 'object' ? user.role?.key ?? user.role?.name : user?.role;
  const roleName = t(roleKey === 'responder' ? 'Responder' : roleKey === 'admin' ? 'Admin' : 'Citizen');
  const displayName = user?.profile?.fullName?.trim() || t('Citizen User');
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const go = (item: Item) => {
    props.navigation.navigate('Main', { screen: item.screen, params: item.params });
    props.navigation.closeDrawer();
  };

  const confirmLogout = () => {
    Alert.alert(t('Log out?'), t('You will stop receiving alerts on this device until you sign in again.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Log out'), style: 'destructive', onPress: logout },
    ]);
  };

  // Re-mount the list each time the drawer opens so the items cascade in.
  let index = 0;
  const renderItem = (item: Item) => {
    const active = current === item.screen;
    const Icon = item.icon;
    const delay = 40 + index++ * 35;
    return (
      <Animated.View key={item.key} entering={FadeInLeft.delay(delay).duration(320)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={() => go(item)}
          scaleTo={0.97}
          style={[styles.item, active && styles.itemActive]}
        >
          <View style={[styles.itemIcon, active && { backgroundColor: colors.accent }]}>
            <Icon color={active ? colors.onAccent : colors.accentText} size={18} />
          </View>
          <Text style={[styles.itemText, active && styles.itemTextActive]}>{t(item.label)}</Text>
        </PressableScale>
      </Animated.View>
    );
  };

  return (
    <View style={styles.drawerContainer}>
      <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
        <LinearGradient
          colors={gradients.accent}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.userPhone}>{user?.phone}</Text>
            <View style={styles.roleBadge}>
              <Shield color={colors.onAccent} size={10} />
              <Text style={styles.roleBadgeText}>{roleName}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.toggles}>
          <LanguageToggle style={{ flex: 1 }} />
          <ThemeToggle />
        </View>

        {isOpen && (
          <>
            {PRIMARY.map(renderItem)}
            <Text style={styles.sectionLabel}>{t('Safety tools')}</Text>
            {SAFETY.map(renderItem)}
            <Text style={styles.sectionLabel}>{t('Records')}</Text>
            {RECORDS.map(renderItem)}
          </>
        )}
      </DrawerContentScrollView>

      <View style={styles.footer}>
        <PressableScale style={styles.logoutBtn} onPress={confirmLogout} accessibilityRole="button">
          <LogOut color={colors.dangerText} size={19} />
          <Text style={styles.logoutText}>{t('Log out')}</Text>
        </PressableScale>
        <Text style={styles.footerNote}>নারী সুরক্ষা · {t('National Women Safety Service')}</Text>
      </View>
    </View>
  );
}

export default function DrawerNavigator() {
  const { colors } = useTheme();
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: colors.bg, width: 300 },
        drawerType: 'front',
        overlayColor: colors.scrim,
      }}
    >
      {/* MainStack lives inside the drawer so the menu reaches every screen. */}
      <Drawer.Screen name="Main" component={MainStack} />
    </Drawer.Navigator>
  );
}

const makeStyles = ({ colors, shadows }: Theme) =>
  StyleSheet.create({
    drawerContainer: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingTop: spacing.md, paddingHorizontal: spacing.sm },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      marginBottom: spacing.md,
      ...shadows.accent,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(255,255,255,0.22)',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: { color: colors.onAccent, fontWeight: '800', fontSize: 17 },
    userName: { ...type.h3, fontWeight: '700', color: colors.onAccent },
    userPhone: { ...type.xs, color: colors.onAccent, opacity: 0.85 },
    roleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 6,
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: radius.full,
      paddingHorizontal: 8,
      paddingVertical: 2,
      alignSelf: 'flex-start',
    },
    roleBadgeText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
    toggles: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.xs,
    },
    sectionLabel: {
      ...type.label,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginHorizontal: spacing.md,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      marginBottom: 2,
    },
    itemActive: { backgroundColor: colors.accentSoft },
    itemIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemText: { ...type.body, fontWeight: '500', color: colors.text, flexShrink: 1 },
    itemTextActive: { color: colors.accentText, fontWeight: '700' },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: spacing.sm,
    },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.dangerSoft,
    },
    logoutText: { ...type.bodyStrong, color: colors.dangerText },
    footerNote: { ...type.xs, color: colors.textMuted, textAlign: 'center' },
  });
