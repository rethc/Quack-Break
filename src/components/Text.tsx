import { Text as RNText, type TextProps } from 'react-native';

import { fonts, useTheme } from '@/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'small';

const styles: Record<Variant, { fontFamily: string; fontSize: number; lineHeight: number }> = {
  display: { fontFamily: fonts.bold, fontSize: 56, lineHeight: 64 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36 },
  heading: { fontFamily: fonts.semibold, fontSize: 21, lineHeight: 27 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
};

// Big numbers stop growing a bit earlier so they still fit with the largest text sizes.
const maxScale: Partial<Record<Variant, number>> = { display: 1.6, title: 1.8 };

export function Text({
  variant = 'body',
  soft,
  color,
  center,
  style,
  ...rest
}: TextProps & { variant?: Variant; soft?: boolean; color?: string; center?: boolean }) {
  const { colors } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={maxScale[variant]}
      accessibilityRole={variant === 'title' ? 'header' : undefined}
      {...rest}
      style={[
        styles[variant],
        { color: color ?? (soft ? colors.inkSoft : colors.ink) },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}
