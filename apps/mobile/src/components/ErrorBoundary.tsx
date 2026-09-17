import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemeContext } from '../theme/ThemeProvider';
import { lightPalette, radius, spacing, type as typeScale } from '../theme/tokens';
import { tStatic } from '../i18n';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: string;
}

export class ErrorBoundary extends Component<Props, State> {
  /**
   * A class component, so the palette comes from context rather than a hook.
   * If the provider is somehow missing — which is exactly the sort of broken
   * state that lands us here — the light palette is a readable fallback.
   */
  static contextType = ThemeContext;
  declare context: React.ContextType<typeof ThemeContext>;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const colors = this.context?.colors ?? lightPalette;
      return (
        <View style={[styles.container, { backgroundColor: colors.bg }]}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={[styles.title, { color: colors.text }]}>{tStatic('Something went wrong')}</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>{this.state.error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.btn, { backgroundColor: colors.accent }]}
            onPress={() => this.setState({ hasError: false, error: '' })}
          >
            <Text style={[styles.btnText, { color: colors.onAccent }]}>{tStatic('Try again')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Layout only. Every colour is applied at render time from the palette. */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  icon: { fontSize: 64, marginBottom: spacing.md },
  title: {
    ...typeScale.h1,
    marginBottom: spacing.sm + 4,
    textAlign: 'center',
  },
  message: {
    ...typeScale.sm,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  btn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.full,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnText: { ...typeScale.bodyStrong },
});
