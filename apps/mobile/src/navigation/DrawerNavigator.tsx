import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { Settings, Home, LogOut, ShieldAlert, FileText, User, Users, Shield } from 'lucide-react-native';
import MainStack from './MainStack';
import { colors, font, spacing, radius } from '../theme';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

const Drawer = createDrawerNavigator();

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { user, updateUser, logout } = useAuthStore();
  const state = props.state;
  const currentRoute = state.routes[state.index].name;

  // Refresh profile from server so we always show the latest name.
  // NOTE: the API nests the profile under `data.profile`.
  useEffect(() => {
    api.get('/profile').then(res => {
      const profile = res.data?.data?.profile;
      if (profile?.fullName) {
        updateUser({ profile: { fullName: profile.fullName, bloodGroup: profile.bloodGroup } });
      }
    }).catch(() => {});
  }, []);

  const roleName = typeof user?.role === 'object' ? user.role?.name : user?.role || 'Citizen';
  const displayName = user?.profile?.fullName?.trim() || 'Citizen User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={styles.drawerContainer}>
      <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
        {/* Profile Header */}
      <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.userPhone}>{user?.phone}</Text>
            <View style={styles.roleBadge}>
              <Shield color={colors.primary} size={10} />
              <Text style={styles.roleBadgeText}>{roleName}</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Navigation Items */}
        <DrawerItem 
          icon={<Home color={currentRoute === 'Main' ? colors.primary : colors.textSub} size={22} />}
          label="Home"
          isActive={currentRoute === 'Main'}
          onPress={() => props.navigation.navigate('Main')}
        />
        
        <DrawerItem 
          icon={<Settings color={currentRoute === 'Settings' ? colors.primary : colors.textSub} size={22} />}
          label="Settings"
          isActive={currentRoute === 'Settings'}
          onPress={() => props.navigation.navigate('Main', { screen: 'Settings' })}
        />

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>Other Features</Text>
        
        <DrawerItem
          icon={<User color={colors.textSub} size={22} />}
          label="Profile"
          isActive={false}
          onPress={() => props.navigation.navigate('Main', { screen: 'ProfileSetup' })}
        />
        <DrawerItem
          icon={<Users color={colors.textSub} size={22} />}
          label="Trusted Contacts"
          isActive={false}
          onPress={() => props.navigation.navigate('Main', { screen: 'TrustedContacts' })}
        />
        <DrawerItem
          icon={<FileText color={colors.textSub} size={22} />}
          label="Report Incident"
          isActive={false}
          onPress={() => props.navigation.navigate('Main', { screen: 'ReportIncident' })}
        />

      </DrawerContentScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <LogOut color={colors.danger} size={20} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DrawerItem({ icon, label, isActive, onPress }: { icon: React.ReactNode, label: string, isActive: boolean, onPress: () => void }) {
  return (
    <TouchableOpacity 
      style={[styles.item, isActive && styles.itemActive]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.itemIcon}>{icon}</View>
      <Text style={[styles.itemText, isActive && styles.itemTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DrawerNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: colors.bg,
          width: 280,
        },
        drawerType: 'front',
      }}
    >
      {/* We load MainStack inside Drawer so hamburger menu handles all screens */}
      <Drawer.Screen name="Main" component={MainStack} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingTop: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    color: '#fff',
    fontFamily: font.bold,
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: colors.text,
    fontFamily: font.semiBold,
    fontSize: 18,
    marginBottom: 2,
  },
  userPhone: {
    color: colors.textSub,
    fontFamily: font.medium,
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: spacing.md,
    marginHorizontal: spacing.lg,
  },
  sectionLabel: {
    color: colors.textSub,
    fontFamily: font.semiBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  itemActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // Primary color with low opacity
  },
  itemIcon: {
    marginRight: spacing.md,
  },
  itemText: {
    color: colors.text,
    fontFamily: font.medium,
    fontSize: 16,
  },
  itemTextActive: {
    color: colors.primary,
    fontFamily: font.semiBold,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing['2xl'],
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  logoutText: {
    color: colors.danger,
    fontFamily: font.semiBold,
    fontSize: 16,
    marginLeft: spacing.md,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontFamily: font.semiBold,
    textTransform: 'capitalize',
  },
});
