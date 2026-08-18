/**
 * Unit banner on the learn path.
 *
 * Marks where one unit ends and the next begins, states what the unit teaches,
 * and shows how much of it is done. Locked units carry the reason they are
 * locked instead of a silent grey card.
 *
 * @module components/learn/unit_header
 */

import { Crown } from 'lucide-react-native';
import { View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

export function UnitHeader({
  index,
  title,
  description,
  done,
  total,
  locked = false,
  lockedLabel,
  courseId,
  unitLabel,
  progressLabel,
}: {
  index: number;
  title: string;
  description: string;
  done: number;
  total: number;
  locked?: boolean;
  lockedLabel?: string;
  courseId: 'python' | 'javascript';
  /** Already-localized "Unit N". */
  unitLabel: string;
  /** Already-localized "x/y lessons". */
  progressLabel: string;
}) {
  const ratio = total === 0 ? 0 : done / total;

  return (
    <View
      className={cn(
        'gap-3 rounded-3xl px-5 py-5',
        courseId === 'python' ? 'bg-course-python/15' : 'bg-course-javascript/15'
      )}>
      <View className="flex-row items-center justify-between">
        <Text
          className={cn(
            'text-xs font-bold uppercase tracking-widest',
            courseId === 'python' ? 'text-course-python' : 'text-course-javascript'
          )}>
          {unitLabel}
        </Text>

        {locked ? (
          <View className="flex-row items-center gap-1.5 rounded-full bg-warning/20 px-2.5 py-1">
            <Icon as={Crown} size={13} className="text-warning" />
            <Text className="text-[11px] font-bold uppercase tracking-wide text-warning">
              {lockedLabel}
            </Text>
          </View>
        ) : (
          <Text className="text-xs font-semibold text-muted-foreground">{progressLabel}</Text>
        )}
      </View>

      <View className="gap-1">
        <Text className="font-display text-[22px] leading-7 text-foreground">{title}</Text>
        <Text className="text-[14px] leading-5 text-muted-foreground">{description}</Text>
      </View>

      <View className="h-2 overflow-hidden rounded-full bg-background/60">
        <View
          className={cn(
            'h-full rounded-full',
            courseId === 'python' ? 'bg-course-python' : 'bg-course-javascript'
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </View>
    </View>
  );
}

/** Index-based horizontal offsets that turn a list of nodes into a path. */
export const PATH_OFFSETS = [0, 44, 62, 44, 0, -44, -62, -44];

/** Offset for the nth lesson on the path. */
export function pathOffset(index: number): number {
  return PATH_OFFSETS[index % PATH_OFFSETS.length];
}
