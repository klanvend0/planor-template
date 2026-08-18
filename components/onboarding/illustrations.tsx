/**
 * Onboarding illustrations — the "Cabinet Vector" scene set.
 *
 * Every scene is inline `react-native-svg` rather than a bundled raster, and
 * the deciding reason is not sharpness or bundle size (though it is both of
 * those): the drawings recolour themselves from `themeTokens()` and
 * `syntaxPalette()`, so light and dark are one drawing instead of two exports
 * that quietly drift apart. Nothing here contains a colour literal.
 *
 * The style rules, all of which the scenes below obey:
 *
 * - One canvas: `viewBox="0 0 280 220"`, drawn at `width` with
 *   `preserveAspectRatio="xMidYMid meet"`.
 * - Whole-number coordinates. 2px strokes, 3px for feature strokes. Square
 *   caps, miter joins. Corners come only from `rx`, and only 2, 4, 8 or 12.
 * - No `<Filter>` / `feGaussianBlur`: RNSVG's filter support is unreliable on
 *   Android and silently drops the shape on some drivers. A glow is therefore a
 *   second copy of the same shape, larger and at low opacity. Depth is the
 *   "slab" trick — the same shape offset +4 on Y in `ledgeCard`, behind it.
 * - No text inside the SVG: an illustration must never carry translatable copy.
 *
 * `Bit`, the CRT-headed mascot, is authored once at a local origin and
 * translated into the scenes that want him, so his proportions cannot drift
 * between scenes. The phosphor block cursor is the through-line: it appears in
 * all five scenes and moves — end of a line, into a blank, onto a buggy token,
 * onto the XP bar, then beside the unlocked plate.
 *
 * These are static drawings. There is no enter animation and no caret blink;
 * the scenes are read for a second or two while the slide copy is read.
 *
 * @module components/onboarding/illustrations
 */

import Svg, {
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  Rect,
  Stop,
  type SvgProps,
} from 'react-native-svg';

import { syntaxPalette, themeTokens } from '@/lib/theme';

/** The shared canvas. Every scene is composed inside this box, in whole pixels. */
const WIDTH = 280;
const HEIGHT = 220;

/** Hard corners everywhere — spread onto anything that carries a stroke. */
const STROKE = { strokeLinecap: 'square', strokeLinejoin: 'miter' } as const;

type Tokens = ReturnType<typeof themeTokens>;

export type IllustrationProps = {
  width?: number;
  scheme?: 'light' | 'dark';
} & Omit<SvgProps, 'width' | 'height' | 'viewBox'>;

function useFrame(width: number) {
  return {
    width,
    height: (width / WIDTH) * HEIGHT,
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    preserveAspectRatio: 'xMidYMid meet',
  };
}

/**
 * The protagonist: a phosphor block cursor, 10 wide and 12 tall (18 when it
 * stands beside a bar). It carries its own glow, which is a second copy of the
 * rectangle at low opacity rather than a blur.
 */
function BlockCursor({
  x,
  y,
  height = 12,
  color,
}: {
  x: number;
  y: number;
  height?: number;
  color: string;
}) {
  return (
    <G>
      <Rect x={x - 4} y={y - 4} width={18} height={height + 8} rx={4} fill={color} opacity={0.16} />
      <Rect x={x} y={y} width={10} height={height} rx={2} fill={color} />
    </G>
  );
}

/** What Bit is showing on his screen. `blank` lets a scene draw its own. */
type BitScreen = 'face' | 'thinking' | 'blank';

/**
 * "Bit" — a cabinet with a CRT for a head, never a face on a blob.
 *
 * Authored once at a local origin: head at (0,0), antenna tip at y=-22, feet at
 * y=146. Scenes place him with `translate(x, y) scale(s)`, which is why this is
 * a component and not five copies of the same geometry.
 */
function Bit({
  tokens,
  x,
  y,
  scale = 1,
  screen = 'face',
}: {
  tokens: Tokens;
  x: number;
  y: number;
  scale?: number;
  screen?: BitScreen;
}) {
  return (
    <G transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Antenna first, so the head sits over its base. The diamond lights up
          in accent while Bit is thinking. */}
      <Line x1={48} y1={0} x2={48} y2={-14} stroke={tokens.border} strokeWidth={2} {...STROKE} />
      <Polygon
        points="48,-22 54,-16 48,-10 42,-16"
        fill={screen === 'thinking' ? tokens.accent : tokens.border}
      />

      {/* Legs, then body, then head — back to front. */}
      <Rect x={30} y={128} width={10} height={18} fill={tokens.border} />
      <Rect x={56} y={128} width={10} height={18} fill={tokens.border} />
      <Rect
        x={20}
        y={84}
        width={56}
        height={44}
        rx={8}
        fill={tokens.surface2}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />
      <Rect
        x={0}
        y={0}
        width={96}
        height={80}
        rx={12}
        fill={tokens.surface2}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />
      <Rect x={10} y={10} width={76} height={56} rx={4} fill={tokens.codeBg} />

      {screen === 'face' ? (
        <G>
          <Rect x={26} y={30} width={12} height={12} fill={tokens.primary} />
          <Rect x={58} y={30} width={12} height={12} fill={tokens.primary} />
          <Rect x={36} y={50} width={24} height={4} fill={tokens.primary} />
        </G>
      ) : null}

      {screen === 'thinking' ? (
        <G>
          <Rect x={24} y={34} width={10} height={10} fill={tokens.primary} />
          <Rect x={43} y={34} width={10} height={10} fill={tokens.primary} />
          <Rect x={62} y={34} width={10} height={10} fill={tokens.primary} />
        </G>
      ) : null}
    </G>
  );
}

/** The flame silhouette, reused at four sizes to build scene 4's fire. */
const FLAME = '140,24 156,48 148,48 160,72 120,72 132,48 124,48';

/**
 * Scene 1 — "The screen wakes".
 *
 * Bit stands at the left with one arm on a code card whose four bars have just
 * lit up; the cursor waits at the end of the last line. Also the login hero.
 */
export function WelcomeIllustration({
  width = 280,
  scheme = 'light',
  ...props
}: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const syntax = syntaxPalette(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...STROKE} {...props}>
      {/* Sparkles are 4x4 squares — this style has no star glyphs. */}
      <Rect x={24} y={30} width={4} height={4} fill={tokens.accent} />
      <Rect x={268} y={36} width={4} height={4} fill={tokens.accent} />

      {/* The card: slab copy +4 on Y for depth, then the screen itself. */}
      <Rect x={140} y={58} width={120} height={96} rx={12} fill={tokens.ledgeCard} />
      <Rect
        x={140}
        y={54}
        width={120}
        height={96}
        rx={12}
        fill={tokens.codeBg}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />

      {/* Three lines of code coming up on the screen. */}
      <Rect x={152} y={70} width={56} height={8} rx={2} fill={syntax.keyword} />
      <Rect x={214} y={70} width={32} height={8} rx={2} fill={syntax.string} />
      <Rect x={152} y={90} width={80} height={8} rx={2} fill={syntax.plain} opacity={0.5} />
      <Rect x={164} y={110} width={44} height={8} rx={2} fill={syntax.function} />

      {/* Scanlines: the CRT tell, barely there. */}
      <Line
        x1={140}
        y1={84}
        x2={260}
        y2={84}
        stroke={tokens.foreground}
        strokeWidth={2}
        opacity={0.06}
        {...STROKE}
      />
      <Line
        x1={140}
        y1={124}
        x2={260}
        y2={124}
        stroke={tokens.foreground}
        strokeWidth={2}
        opacity={0.06}
        {...STROKE}
      />

      <BlockCursor x={214} y={108} color={tokens.primary} />

      <Bit tokens={tokens} x={24} y={44} scale={0.8} />
      {/* Bit's arm is drawn in scene space, because it reaches out of his own
          box and onto the card's left edge. */}
      <Polyline
        points="100,96 128,96 140,88"
        fill="none"
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />
    </Svg>
  );
}

/**
 * Scene 2 — "Five ways to practise".
 *
 * A line with a dashed blank in it, the cursor already parked inside, and a
 * bank of three token chips below with the middle one lifting into place.
 */
export function PuzzlesIllustration({
  width = 280,
  scheme = 'light',
  ...props
}: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const syntax = syntaxPalette(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...STROKE} {...props}>
      <Rect
        x={28}
        y={40}
        width={224}
        height={110}
        rx={12}
        fill={tokens.codeBg}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />

      <Rect x={44} y={60} width={48} height={8} rx={2} fill={syntax.keyword} />
      <Rect x={98} y={60} width={64} height={8} rx={2} fill={syntax.plain} opacity={0.45} />

      {/* The blank waiting to be filled. */}
      <Rect
        x={44}
        y={82}
        width={72}
        height={24}
        rx={4}
        fill={syntax.blankSlot}
        stroke={tokens.primary}
        strokeWidth={2}
        strokeDasharray="6 4"
        {...STROKE}
      />
      <BlockCursor x={52} y={88} color={tokens.primary} />

      {/* The rest of the snippet, dimmed — it is context, not the question. */}
      <Rect x={44} y={120} width={136} height={8} rx={2} fill={syntax.plain} opacity={0.25} />

      {/* Glow behind the chip that is on its way up. */}
      <Rect x={104} y={158} width={60} height={32} rx={8} fill={tokens.primary} opacity={0.14} />

      {/* Motion ticks trailing the lifted chip. */}
      <Rect x={100} y={174} width={4} height={4} fill={tokens.primary} opacity={0.7} />
      <Rect x={92} y={174} width={4} height={4} fill={tokens.primary} opacity={0.45} />
      <Rect x={84} y={174} width={4} height={4} fill={tokens.primary} opacity={0.25} />

      {/* Token bank. The middle chip is lifted and takes the 3px feature stroke. */}
      {[44, 108, 172].map((chipX, index) => {
        const lifted = index === 1;
        const chipY = lifted ? 162 : 170;
        return (
          <G key={chipX}>
            <Rect
              x={chipX}
              y={chipY}
              width={52}
              height={24}
              rx={4}
              fill={tokens.surface2}
              stroke={lifted ? tokens.primary : tokens.input}
              strokeWidth={lifted ? 3 : 2}
              {...STROKE}
            />
            <Rect
              x={chipX + 12}
              y={chipY + 10}
              width={28}
              height={4}
              rx={2}
              fill={syntax.punctuation}
            />
          </G>
        );
      })}
    </Svg>
  );
}

/**
 * Scene 3 — "Spot the bug".
 *
 * An editor with a gutter, a highlighted suspect line rail-marked in warning, a
 * wavy error underline beneath the offending token, and Bit peering up from the
 * bottom right with a question mark on his screen.
 */
export function MistakesIllustration({
  width = 280,
  scheme = 'light',
  ...props
}: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const syntax = syntaxPalette(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...STROKE} {...props}>
      <Rect
        x={28}
        y={34}
        width={224}
        height={120}
        rx={12}
        fill={tokens.codeBg}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />

      {/* Gutter rule and three line numbers, reduced to blocks. */}
      <Line
        x1={52}
        y1={34}
        x2={52}
        y2={154}
        stroke={tokens.codeBorder}
        strokeWidth={2}
        {...STROKE}
      />
      <Rect x={40} y={54} width={4} height={8} fill={syntax.gutter} />
      <Rect x={40} y={86} width={4} height={8} fill={syntax.gutter} />
      <Rect x={40} y={118} width={4} height={8} fill={syntax.gutter} />

      {/* The suspect line: active-line well plus a warning rail in the gutter. */}
      <Rect x={54} y={82} width={196} height={20} fill={syntax.activeLine} />
      <Rect x={52} y={82} width={3} height={20} fill={tokens.warning} />

      <Rect x={64} y={54} width={72} height={8} rx={2} fill={syntax.keyword} />
      <Rect x={64} y={88} width={48} height={8} rx={2} fill={syntax.builtin} />
      <Rect x={64} y={122} width={96} height={8} rx={2} fill={syntax.plain} opacity={0.4} />

      {/* The one curve in the whole set, and it has to be one. */}
      <Path
        d="M 64,102 q 3,-3 6,0 t 6,0 t 6,0 t 6,0 t 6,0 t 6,0 t 6,0 t 6,0"
        fill="none"
        stroke={syntax.errorUnderline}
        strokeWidth={2}
        {...STROKE}
      />

      <BlockCursor x={120} y={86} color={tokens.primary} />

      <Bit tokens={tokens} x={196} y={158} scale={0.42} screen="blank" />
      {/* The "?" is drawn in scene space rather than inside Bit: at 0.42 scale a
          3px feature stroke authored in his local box would come out at 1.3px. */}
      <Polyline
        points="207,170 211,165 219,165 223,169"
        fill="none"
        stroke={tokens.primary}
        strokeWidth={3}
        {...STROKE}
      />
      <Polyline
        points="223,169 215,174 215,177"
        fill="none"
        stroke={tokens.primary}
        strokeWidth={3}
        {...STROKE}
      />
      <Rect x={213} y={180} width={4} height={4} fill={tokens.primary} />
    </Svg>
  );
}

/**
 * Scene 5 — "Everything unlocked".
 *
 * A scoreboard panel: four rows of label / dotted leader / value, three earned
 * marks, and an open padlock with the cursor beside it. This is the scene the
 * spec also earmarks for the paywall hero and the lesson-clear panel; on the
 * "an AI reads your answer" slide it reads as the graded readout, with Bit
 * thinking it over at the left.
 */
export function AiIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const syntax = syntaxPalette(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...STROKE} {...props}>
      {/* Slab copy +4 on Y, then the panel. */}
      <Rect x={28} y={34} width={224} height={132} rx={12} fill={tokens.ledgeCard} />
      <Rect
        x={28}
        y={30}
        width={224}
        height={132}
        rx={12}
        fill={tokens.codeBg}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />

      {/* Four scoreboard rows. */}
      {[52, 76, 100, 124].map((rowY) => (
        <G key={rowY}>
          <Rect x={44} y={rowY} width={52} height={6} rx={2} fill={syntax.punctuation} />
          <Line
            x1={104}
            y1={rowY + 4}
            x2={200}
            y2={rowY + 4}
            stroke={tokens.border}
            strokeWidth={2}
            strokeDasharray="2 4"
            {...STROKE}
          />
          <Rect x={208} y={rowY} width={28} height={8} rx={2} fill={tokens.xp} />
        </G>
      ))}

      {/* Three earned marks: 12x12 squares stood on a corner. */}
      {[112, 140, 168].map((cx) => (
        <Rect
          key={cx}
          x={-6}
          y={-6}
          width={12}
          height={12}
          fill={tokens.xp}
          transform={`translate(${cx}, 150) rotate(45)`}
        />
      ))}

      {/* The plate, with its glow as a larger duplicate behind it. */}
      <Rect x={118} y={166} width={44} height={36} rx={8} fill={tokens.primary} opacity={0.14} />
      <Path
        d="M 130,172 L 130,164 A 8,8 0 0 1 146,164"
        fill="none"
        stroke={tokens.primary}
        strokeWidth={3}
        {...STROKE}
      />
      <Rect x={124} y={172} width={32} height={24} rx={4} fill={tokens.primary} />
      <Rect x={138} y={180} width={4} height={8} rx={2} fill={tokens.codeBg} />

      <BlockCursor x={168} y={176} height={18} color={tokens.primary} />

      <Bit tokens={tokens} x={22} y={164} scale={0.36} screen="thinking" />
    </Svg>
  );
}

/**
 * Scene 4 — "Keep the streak".
 *
 * The one scene allowed two heroes, because streak and XP are both gamification
 * tokens: an angular flame, a seven-day strip with today outlined and tomorrow
 * still to earn, and the XP meter with the cursor standing at its end.
 */
export function StreakIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);
  const meterId = `xpMeterFill-${scheme}`;
  // The spec's flame core is a pale cream literal and the palette has no such
  // token, so take the scheme's near-white plane: white-hot in both themes.
  const core = scheme === 'dark' ? tokens.foreground : tokens.background;

  return (
    <Svg {...frame} {...STROKE} {...props}>
      <Defs>
        {/* The single gradient this scene is allowed: 2-stop, vertical. */}
        <LinearGradient id={meterId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tokens.primary} />
          <Stop offset="1" stopColor={tokens.accent} />
        </LinearGradient>
      </Defs>

      {/* Flame: the same polygon four times, scaled about its base at (140,72).
          The largest copy is the glow — a duplicate shape, never a blur. */}
      <Polygon
        points={FLAME}
        fill={tokens.streak}
        opacity={0.16}
        transform="translate(140,72) scale(1.4) translate(-140,-72)"
      />
      <Polygon points={FLAME} fill={tokens.streak} />
      <Polygon
        points={FLAME}
        fill={tokens.xp}
        transform="translate(140,72) scale(0.7) translate(-140,-72)"
      />
      <Polygon
        points={FLAME}
        fill={core}
        transform="translate(140,72) scale(0.4) translate(-140,-72)"
      />

      {/* Seven days: five kept, today outlined, tomorrow struck through. */}
      {[0, 1, 2, 3, 4, 5, 6].map((index) => {
        const x = 56 + index * 24;
        const kept = index < 5;
        const today = index === 5;
        return (
          <G key={index}>
            <Rect
              x={x}
              y={110}
              width={16}
              height={16}
              rx={4}
              fill={kept ? tokens.streak : tokens.muted}
              stroke={today ? tokens.primary : undefined}
              strokeWidth={today ? 2 : undefined}
              {...STROKE}
            />
            {index === 6 ? (
              <Line
                x1={x}
                y1={110}
                x2={x + 16}
                y2={126}
                stroke={tokens.border}
                strokeWidth={2}
                {...STROKE}
              />
            ) : null}
          </G>
        );
      })}

      {/* XP meter. rx=8 on a 14-tall track clamps to a 7px pill, which keeps the
          allowed radius set intact without changing the shape. */}
      <Rect
        x={56}
        y={150}
        width={168}
        height={14}
        rx={8}
        fill={tokens.surface2}
        stroke={tokens.border}
        strokeWidth={2}
        {...STROKE}
      />
      <Rect x={58} y={152} width={104} height={10} rx={8} fill={`url(#${meterId})`} />
      {[100, 140, 180].map((x) => (
        <Line
          key={x}
          x1={x}
          y1={152}
          x2={x}
          y2={162}
          stroke={tokens.border}
          strokeWidth={2}
          {...STROKE}
        />
      ))}

      <BlockCursor x={228} y={148} height={18} color={tokens.primary} />
    </Svg>
  );
}

/** Illustration for each onboarding slide, in slide order. */
export const ONBOARDING_ILLUSTRATIONS = {
  welcome: WelcomeIllustration,
  puzzles: PuzzlesIllustration,
  mistakes: MistakesIllustration,
  ai: AiIllustration,
  streak: StreakIllustration,
} as const;

export type OnboardingSlideKey = keyof typeof ONBOARDING_ILLUSTRATIONS;
