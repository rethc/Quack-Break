import { ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

/** Safe-area page that scrolls, so large text sizes never cut anything off. */
export function Screen({
  children,
  contentStyle,
  background,
}: {
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Page colour; the theme background by default. */
  background?: string;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: background ?? colors.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, contentStyle]}
        contentInsetAdjustmentBehavior="never"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: space.m, gap: space.m },
});
