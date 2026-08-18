/**
 * Bottom tab bar.
 *
 * Custom rather than the platform default so the active tab can be as loud as a
 * game needs it to be. Three tabs, safe-area aware, each a 56pt target.
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
      className="flex-row border-t border-border bg-card px-2 pt-2"
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
            className="h-14 flex-1 items-center justify-center gap-1 rounded-2xl">
            <Icon
              as={ICONS[route.name] ?? GraduationCap}
              size={24}
              className={isFocused ? 'text-primary' : 'text-muted-foreground'}
            />
            <Text
              className={cn(
                'text-[11px] font-bold',
                isFocused ? 'text-primary' : 'text-muted-foreground'
              )}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
