/**
 * Syntax palette for the active appearance.
 *
 * The code surface is a paper panel in light mode and the darkest plane in dark
 * mode, so the highlighter's colours are genuinely two palettes rather than one
 * tinted. Components read them through this hook instead of importing the map.
 *
 * @module hooks/use_syntax
 */

import { useColorScheme } from 'nativewind';

import { syntaxPalette, type SyntaxPalette } from '@/lib/theme';

export function useSyntax(): SyntaxPalette {
  const { colorScheme } = useColorScheme();
  return syntaxPalette(colorScheme);
}
