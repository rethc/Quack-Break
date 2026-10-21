import { ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

/** Safe-area page that scrolls, so large text sizes never cut anything off. */
export function Screen({ children, contentStyle }: { children: React.ReactNode; contentStyle?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]} edges={['top', 'bottom', 'left', 'right']}>
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
