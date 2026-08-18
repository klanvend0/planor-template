/**
 * The teaching card shown before a lesson's questions.
 *
 * One idea, one worked example. It exists so that every question that follows is
 * answerable from something the learner has just been shown, rather than from
 * something they were supposed to already know.
 *
 * @module components/lesson/concept_card
 */

import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CodeBlock } from '@/components/code_block';
import { Text } from '@/components/ui/text';
import type { Lesson } from '@/lib/content_schema';
import { localized } from '@/lib/content_schema';
import type { SupportedLocale } from '@/lib/i18n';
import type { SyntaxLanguage } from '@/lib/syntax';

export function ConceptCard({
  lesson,
  locale,
  language,
}: {
  lesson: Lesson;
  locale: SupportedLocale;
  language: SyntaxLanguage;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(260)} className="gap-6">
      <View className="gap-2">
        <Text className="text-xs font-bold uppercase tracking-widest text-primary">
          {localized(lesson.title, locale)}
        </Text>
        <Text className="font-display text-[26px] leading-8 text-foreground">
          {localized(lesson.concept.headline, locale)}
        </Text>
      </View>

      <Text className="text-[16px] leading-7 text-foreground">
        {localized(lesson.concept.body, locale)}
      </Text>

      <View className="gap-2">
        <CodeBlock code={lesson.concept.example.code} language={language} />
        <Text className="text-sm leading-5 text-muted-foreground">
          {localized(lesson.concept.example.caption, locale)}
        </Text>
      </View>
    </Animated.View>
  );
}
