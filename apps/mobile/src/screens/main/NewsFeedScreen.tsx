/**
 * News feed — safety news, alerts and tips for the user's area.
 * Placeholder screen: the feed itself is developed later.
 */
import React from 'react';
import { Newspaper } from 'lucide-react-native';
import { AppBar, EmptyState, Screen } from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';

export default function NewsFeedScreen() {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Screen>
      <AppBar title={t('News Feed')} subtitle={t('Safety news and alerts near you')} />
      <EmptyState
        icon={<Newspaper size={28} color={colors.accent} />}
        title={t('Coming soon')}
        message={t('Safety news, local alerts and tips will appear here.')}
      />
    </Screen>
  );
}
