/**
 * The small-caps label that heads a section, a stat tile or a badge.
 *
 * It exists because `text-transform: uppercase` is wrong in Turkish: the
 * dotted `i` has to become `İ`, and CSS gives `I`, so "Bugünkü hedefin"
 * renders as "BUGUNKU HEDEFIN" to the learner. The uppercasing therefore
 * happens in JS, against the active locale, and no screen carries the
 * `uppercase` class.
 *
 * @module components/kicker
 */

import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { localeUpper } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function Kicker({
  children,
  className,
  accessibilityLabel,
}: {
  /** Already-translated copy. Casing is applied here, not by the caller. */
  children: string;
  className?: string;
  accessibilityLabel?: string;
}) {
  const { locale } = useTranslation();

  return (
    <Text
      accessibilityLabel={accessibilityLabel}
      className={cn('font-strong text-xs tracking-widest text-muted-foreground', className)}>
      {localeUpper(children, locale)}
    </Text>
  );
}
