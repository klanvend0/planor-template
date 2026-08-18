/**
 * Bottom tab bar.
 *
 * Custom rather than the platform default so the active tab can be as loud as a
 * game needs it to be: a tinted well, a coloured icon and label, and a rail
 * across the top edge. Three tabs, safe-area aware, each a 56pt target.
 *
 * @module components/tab_bar
 */

import type { BottomTabBarProps } from 'expo-router/tabs';
import { GraduationCap, Repeat2, UserRound } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof GraduationCap> = {
  index: GraduationCap,
  practice: Repeat2,
  profile: UserRound,
};

export function GameTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t-2 border-border bg-card px-2 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : (options.title ?? route.name);

        const onPress = () => {
          void tapFeedback();
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={label}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            className={cn(
              'h-14 flex-1 items-center justify-center gap-1 rounded-lg',
              isFocused && 'bg-primary/12'
            )}>
            {isFocused ? (
              <View className="absolute top-0 h-[2px] w-8 rounded-full bg-primary" />
            ) : null}

            <Icon
              as={ICONS[route.name] ?? GraduationCap}
              size={24}
              className={isFocused ? 'text-primary' : 'text-muted-foreground'}
            />
            <Text
              className={cn(
                'font-strong text-[11px] tracking-[0.6px]',
                isFocused ? 'text-primary' : 'text-muted-foreground'
              )}
              maxFontSizeMultiplier={1.4}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
