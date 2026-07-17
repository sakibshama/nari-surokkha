import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Moon, Shield, Eye, Lock, ChevronRight } from 'lucide-react-native';
import { colors, font, spacing, radius } from '../../theme';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { Activity } from 'lucide-react-native'; // For ML icon

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [locationSharing, setLocationSharing] = useState(true);

  const { logout } = useAuthStore();
  const { mlVoiceEnabled, mlGyroEnabled, setMlVoiceEnabled, setMlGyroEnabled } = useSettingsStore();

  const renderSettingRow = (icon: React.ReactNode, title: string, control: React.ReactNode) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <View style={styles.iconBox}>{icon}</View>
        <Text style={styles.settingTitle}>{title}</Text>
      </View>
      {control}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          {renderSettingRow(
            <Bell size={20} color={colors.text} />, 
            'Push Notifications', 
            <Switch 
              value={notifications} 
              onValueChange={setNotifications} 
              trackColor={{ false: '#334155', true: colors.primary }}
              thumbColor="#fff"
            />
          )}
          <View style={styles.divider} />
          {renderSettingRow(
            <Moon size={20} color={colors.text} />, 
            'Dark Mode', 
            <Switch 
              value={darkMode} 
              onValueChange={setDarkMode} 
              trackColor={{ false: '#334155', true: colors.primary }}
              thumbColor="#fff"
            />
          )}
        </View>

        <Text style={styles.sectionTitle}>Privacy & Security</Text>
        <View style={styles.card}>
          {renderSettingRow(
            <Shield size={20} color={colors.text} />, 
            'Background Location', 
            <Switch 
              value={locationSharing} 
              onValueChange={setLocationSharing} 
              trackColor={{ false: '#334155', true: colors.primary }}
              thumbColor="#fff"
            />
          )}
          <View style={styles.divider} />
          <TouchableOpacity activeOpacity={0.7}>
            {renderSettingRow(
              <Lock size={20} color={colors.text} />, 
              'Change Password', 
              <ChevronRight size={20} color={colors.textSub} />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Machine Learning (Offline)</Text>
        <View style={styles.card}>
          {renderSettingRow(
            <Activity size={20} color={colors.text} />, 
            'Voice Distress Detection', 
            <Switch 
              value={mlVoiceEnabled} 
              onValueChange={setMlVoiceEnabled} 
              trackColor={{ false: '#334155', true: colors.primary }}
              thumbColor="#fff"
            />
          )}
          <View style={styles.divider} />
          {renderSettingRow(
            <Activity size={20} color={colors.text} />, 
            'Fall & Struggle Detection', 
            <Switch 
              value={mlGyroEnabled} 
              onValueChange={setMlGyroEnabled} 
              trackColor={{ false: '#334155', true: colors.primary }}
              thumbColor="#fff"
            />
          )}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.8}>
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontFamily: font.semiBold,
    fontSize: 14,
    color: colors.textSub,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  settingTitle: {
    fontFamily: font.medium,
    fontSize: 16,
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: spacing.xl + spacing.md,
  },
  logoutBtn: {
    marginTop: spacing['2xl'],
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: colors.danger,
    fontFamily: font.semiBold,
    fontSize: 16,
  },
});
