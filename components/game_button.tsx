/**
 * The app's primary button.
 *
 * A game needs a button that feels physical: it sits on a coloured shelf and
 * presses down into it. Built on `Pressable` so the whole surface is the target
 * (minimum 52pt tall, comfortably above the 44pt floor), with a busy state that
 * keeps the label in place instead of collapsing the layout.
 *
 * @module components/game_button
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';

import { Text, TextClassContext } from '@/components/ui/text';
import { pressFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/**
 * The ledge the face presses into. Each variant has its own colour token rather
 * than a translucent tint of the face, so the depth reads the same on every
 * surface the button sits on.
 */
const shelfVariants = cva('rounded-2xl', {
  variants: {
    variant: {
      primary: 'bg-primary-ledge',
      success: 'bg-success-ledge',
      destructive: 'bg-destructive-ledge',
      secondary: 'bg-secondary-ledge',
      ghost: 'bg-transparent',
    },
  },
  defaultVariants: { variant: 'primary' },
});

const faceVariants = cva(
  'w-full flex-row items-center justify-center gap-2 rounded-2xl active:translate-y-[3px]',
  {
    variants: {
      variant: {
        primary: 'bg-primary',
        success: 'bg-success',
        destructive: 'bg-destructive',
        secondary: 'border border-border bg-card',
        ghost: 'bg-transparent',
      },
      size: {
        sm: 'h-11 px-4',
        md: 'h-[52px] px-5',
        lg: 'h-[58px] px-6',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

const labelVariants = cva('font-strong uppercase tracking-wide', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      success: 'text-success-foreground',
      destructive: 'text-destructive-foreground',
      secondary: 'text-foreground',
      ghost: 'text-muted-foreground',
    },
    size: {
      sm: 'text-[13px]',
      md: 'text-[15px]',
      lg: 'text-base',
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
    /** Drop the pressable shelf, e.g. inside a dense list. */
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
  const isDisabled = disabled || busy;

  return (
    <View className={cn(shelfVariants({ variant }), !flat && 'pb-[3px]', className)}>
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
            <ActivityIndicator
              size="small"
              className={
                variant === 'secondary' || variant === 'ghost' ? 'text-foreground' : 'text-white'
              }
            />
          ) : (
            <>
              {icon}
              <Text className={labelVariants({ variant, size })} numberOfLines={1}>
                {label}
              </Text>
            </>
          )}
        </TextClassContext.Provider>
      </Pressable>
    </View>
  );
}
