/**
 * Teach NativeWind about Reanimated's components.
 *
 * `className` only reaches a component NativeWind knows how to map it onto.
 * Its own registrations cover React Native's core components, but not the ones
 * `createAnimatedComponent` produces — so `<Animated.View className="flex-row">`
 * silently rendered a column, and every animated element in this app quietly
 * lost its styling: the hearts in the HUD stacked, the lesson progress bar's
 * fill had no colour, the results stars did not centre.
 *
 * Importing this module once, before the first screen renders, fixes all of
 * them. It must be imported for its side effect only.
 *
 * @module lib/nativewind_interop
 */

import { cssInterop } from 'nativewind';
import Animated from 'react-native-reanimated';

for (const component of [
  Animated.View,
  Animated.Text,
  Animated.ScrollView,
  Animated.Image,
  Animated.FlatList,
]) {
  // The animated style the caller passes and the one NativeWind derives are
  // merged into an array, which Reanimated accepts.
  cssInterop(component, { className: 'style' });
}
