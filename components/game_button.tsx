/**
 * The app's primary button — the "slab press".
 *
 * The design system has one depth mechanic and no shadows: the button sits on a
 * coloured ledge and its face translates down by exactly the ledge height when
 * pressed, so the control sinks flush and the layout never shifts.
 *
 * Sized for thumbs (52pt tall by default, well above the 44pt floor) and for
 * Turkish, which runs 18-25% longer than English — a CTA may wrap to two lines
 * rather than truncate, because width cannot grow on a phone.
 *
 * @module components/game_button
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';

import { Text, TextClassContext } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { pressFeedback } from '@/lib/haptics';
import { localeUpper } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const shelfVariants = cva('rounded-lg', {
  variants: {
    variant: {
      primary: 'bg-primary-ledge',
      success: 'bg-success-ledge',
      destructive: 'bg-destructive-ledge',
      secondary: 'bg-secondary-ledge',
      ghost: 'bg-transparent',
    },
    size: {
      sm: 'pb-[4px]',
      md: 'pb-[6px]',
      lg: 'pb-[6px]',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

const faceVariants = cva('w-full flex-row items-center justify-center gap-2 rounded-lg', {
  variants: {
    variant: {
      // In light mode a saturated fill needs a defined boundary against the pale
      // page; in dark mode the fill is already the brightest thing on screen.
      primary: 'border-2 border-primary-ledge bg-primary dark:border-0',
      success: 'border-2 border-success-ledge bg-success dark:border-0',
      destructive: 'border-2 border-destructive-ledge bg-destructive dark:border-0',
      secondary: 'border-2 border-input bg-secondary',
      ghost: 'bg-transparent active:bg-secondary',
    },
    size: {
      sm: 'min-h-[44px] px-4 active:translate-y-[4px]',
      md: 'min-h-[52px] px-5 active:translate-y-[6px]',
      lg: 'min-h-[58px] px-6 active:translate-y-[6px]',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

const labelVariants = cva('text-center font-strong tracking-[0.6px]', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      success: 'text-success-foreground',
      destructive: 'text-destructive-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-muted-foreground',
    },
    size: {
      sm: 'text-[13px]',
      md: 'text-[15px]',
      lg: 'text-[17px]',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export type GameButtonProps = Omit<PressableProps, 'children' | 'style'> &
  VariantProps<typeof faceVariants> & {
    /** Button label. Kept as a string so the busy state can swap it safely. */
    label: string;
    /** Rendered left of the label. */
    icon?: React.ReactNode;
    /** Shows a spinner and blocks presses. */
    busy?: boolean;
    className?: string;
    /** Drop the ledge, e.g. for a tertiary action inside a dense list. */
    flat?: boolean;
  };

/**
 * @example
 * <GameButton label={t('lesson.check')} onPress={check} disabled={!answer} />
 */
export function GameButton({
  label,
  icon,
  busy = false,
  variant = 'primary',
  size = 'md',
  disabled,
  flat = false,
  className,
  onPress,
  ...props
}: GameButtonProps) {
  const { locale } = useTranslation();
  const isDisabled = disabled || busy;

  return (
    <View
      className={cn(
        shelfVariants({ variant, size }),
        // A dead control has no depth, and a flat one never had any.
        (flat || isDisabled) && 'pb-0',
        className
      )}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy }}
        disabled={isDisabled}
        onPress={(event) => {
          void pressFeedback();
          onPress?.(event);
        }}
        className={cn(faceVariants({ variant, size }), isDisabled && 'opacity-45')}
        {...props}>
        <TextClassContext.Provider value={labelVariants({ variant, size })}>
          {busy ? (
            <ActivityIndicator size="small" />
          ) : (
            <>
              {icon}
              <Text
                className={labelVariants({ variant, size })}
                // Turkish runs long; two lines beat an ellipsis on a CTA.
                numberOfLines={2}
                maxFontSizeMultiplier={1.4}>
                {localeUpper(label, locale)}
              </Text>
            </>
          )}
        </TextClassContext.Provider>
      </Pressable>
    </View>
  );
}
