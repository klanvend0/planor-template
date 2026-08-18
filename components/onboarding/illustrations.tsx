/**
 * Onboarding illustrations.
 *
 * Drawn as inline SVG rather than shipped as images: they stay crisp at every
 * density, weigh nothing in the bundle, and — the reason that matters here —
 * they recolour themselves from the theme tokens, so light and dark are one
 * drawing rather than two exports.
 *
 * Every illustration is authored on a 320x240 canvas and scales with `width`.
 *
 * @module components/onboarding/illustrations
 */

import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  type SvgProps,
} from 'react-native-svg';

import { SYNTAX, themeTokens } from '@/lib/theme';

const WIDTH = 320;
const HEIGHT = 240;

export type IllustrationProps = {
  width?: number;
  scheme?: 'light' | 'dark';
} & Omit<SvgProps, 'width' | 'height' | 'viewBox'>;

function useFrame(width: number) {
  return { width, height: (width / WIDTH) * HEIGHT, viewBox: `0 0 ${WIDTH} ${HEIGHT}` };
}

/** A rounded "editor" panel used as the base of several illustrations. */
function EditorPanel({
  x = 44,
  y = 40,
  width = 232,
  height = 160,
  fill,
  stroke,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill: string;
  stroke: string;
}) {
  return (
    <G>
      <Rect x={x} y={y} width={width} height={height} rx={20} fill={fill} stroke={stroke} strokeWidth={2} />
      <Circle cx={x + 20} cy={y + 20} r={4} fill="#FF6B6B" />
      <Circle cx={x + 34} cy={y + 20} r={4} fill="#FFC46B" />
      <Circle cx={x + 48} cy={y + 20} r={4} fill="#6BE39B" />
    </G>
  );
}

/** Welcome: code is a language, learn it like one. */
export function WelcomeIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...props}>
      <Defs>
        <LinearGradient id="welcomeGlow" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={tokens.primary} stopOpacity="0.35" />
          <Stop offset="1" stopColor={tokens.accent} stopOpacity="0.12" />
        </LinearGradient>
      </Defs>

      <Circle cx={160} cy={120} r={104} fill="url(#welcomeGlow)" />
      <EditorPanel fill={tokens.codeBg} stroke={tokens.codeBorder} />

      {/* Code lines, with the accent line reading as the "spoken" one. */}
      <Rect x={64} y={78} width={92} height={9} rx={4.5} fill={SYNTAX.keyword} />
      <Rect x={162} y={78} width={54} height={9} rx={4.5} fill={SYNTAX.string} />
      <Rect x={64} y={100} width={132} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.55} />
      <Rect x={78} y={122} width={70} height={9} rx={4.5} fill={SYNTAX.function} />
      <Rect x={154} y={122} width={46} height={9} rx={4.5} fill={SYNTAX.number} />
      <Rect x={64} y={144} width={108} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.35} />

      {/* Speech bubble: the code says something back. */}
      <G>
        <Rect x={196} y={150} width={92} height={54} rx={16} fill={tokens.primary} />
        <Path d="M214 204 L206 222 L232 204 Z" fill={tokens.primary} />
        <Rect x={210} y={168} width={40} height={7} rx={3.5} fill={tokens.primaryForeground} opacity={0.9} />
        <Rect x={210} y={182} width={62} height={7} rx={3.5} fill={tokens.primaryForeground} opacity={0.6} />
      </G>

      <Circle cx={62} cy={54} r={7} fill={tokens.accent} />
      <Circle cx={276} cy={70} r={5} fill={tokens.streak} />
    </Svg>
  );
}

/** Five ways to practise: chips, blanks and choices. */
export function PuzzlesIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...props}>
      <Circle cx={160} cy={118} r={100} fill={tokens.accent} opacity={0.12} />
      <EditorPanel y={28} height={128} fill={tokens.codeBg} stroke={tokens.codeBorder} />

      {/* A line with a blank waiting to be filled */}
      <Rect x={64} y={70} width={48} height={9} rx={4.5} fill={SYNTAX.builtin} />
      <Rect
        x={118}
        y={64}
        width={62}
        height={21}
        rx={7}
        fill="none"
        stroke={tokens.primary}
        strokeWidth={2}
        strokeDasharray="6 5"
      />
      <Rect x={186} y={70} width={34} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.5} />

      <Rect x={64} y={98} width={120} height={9} rx={4.5} fill={SYNTAX.string} opacity={0.85} />
      <Rect x={64} y={122} width={86} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.35} />

      {/* Token chips below, one lifting towards the blank */}
      <G>
        <Rect x={52} y={172} width={68} height={34} rx={12} fill={tokens.card} stroke={tokens.border} strokeWidth={2} />
        <Rect x={66} y={185} width={40} height={8} rx={4} fill={tokens.mutedForeground} />
      </G>
      <G>
        <Rect x={128} y={164} width={68} height={34} rx={12} fill={tokens.primary} />
        <Rect x={142} y={177} width={40} height={8} rx={4} fill={tokens.primaryForeground} />
      </G>
      <G>
        <Rect x={204} y={172} width={64} height={34} rx={12} fill={tokens.card} stroke={tokens.border} strokeWidth={2} />
        <Rect x={218} y={185} width={36} height={8} rx={4} fill={tokens.mutedForeground} />
      </G>
    </Svg>
  );
}

/** Bugs teach you the most. */
export function MistakesIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...props}>
      <Circle cx={160} cy={118} r={100} fill={tokens.destructive} opacity={0.1} />
      <EditorPanel y={36} height={150} fill={tokens.codeBg} stroke={tokens.codeBorder} />

      <Rect x={64} y={76} width={110} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.4} />

      {/* The offending line, highlighted */}
      <Rect x={56} y={96} width={208} height={26} rx={9} fill={tokens.destructive} opacity={0.22} />
      <Rect x={64} y={105} width={64} height={9} rx={4.5} fill={SYNTAX.builtin} />
      <Rect x={134} y={105} width={58} height={9} rx={4.5} fill={tokens.destructive} />

      <Rect x={64} y={136} width={92} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.4} />
      <Rect x={64} y={158} width={130} height={9} rx={4.5} fill={SYNTAX.plain} opacity={0.25} />

      {/* Bug: body, head, legs, antennae */}
      <G>
        <Circle cx={236} cy={150} r={22} fill={tokens.destructive} />
        <Circle cx={236} cy={128} r={11} fill={tokens.destructive} />
        <Path
          d="M214 140 L198 132 M214 150 L196 150 M214 160 L198 168 M258 140 L274 132 M258 150 L276 150 M258 160 L274 168"
          stroke={tokens.destructive}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <Path
          d="M230 120 L224 108 M242 120 L248 108"
          stroke={tokens.destructive}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Circle cx={231} cy={126} r={2.6} fill={tokens.background} />
        <Circle cx={241} cy={126} r={2.6} fill={tokens.background} />
        <Path d="M236 138 L236 164" stroke={tokens.background} strokeWidth={2} opacity={0.5} />
      </G>

      {/* The fix, arriving */}
      <G>
        <Circle cx={72} cy={196} r={20} fill={tokens.success} />
        <Path
          d="M62 196 L69 203 L83 189"
          stroke={tokens.successForeground}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>
    </Svg>
  );
}

/** An AI that reads your answer. */
export function AiIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...props}>
      <Defs>
        <LinearGradient id="aiGlow" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={tokens.primary} stopOpacity="0.4" />
          <Stop offset="1" stopColor={tokens.accent} stopOpacity="0.15" />
        </LinearGradient>
      </Defs>

      <Circle cx={160} cy={116} r={102} fill="url(#aiGlow)" />

      {/* The snippet being explained */}
      <Rect x={34} y={44} width={150} height={106} rx={18} fill={tokens.codeBg} stroke={tokens.codeBorder} strokeWidth={2} />
      <Rect x={50} y={66} width={70} height={8} rx={4} fill={SYNTAX.comment} />
      <Rect x={50} y={86} width={104} height={8} rx={4} fill={SYNTAX.keyword} />
      <Rect x={62} y={106} width={82} height={8} rx={4} fill={SYNTAX.function} />
      <Rect x={50} y={126} width={58} height={8} rx={4} fill={SYNTAX.number} />

      {/* The learner's written answer */}
      <Rect x={96} y={164} width={188} height={56} rx={16} fill={tokens.card} stroke={tokens.border} strokeWidth={2} />
      <Rect x={112} y={182} width={124} height={7} rx={3.5} fill={tokens.mutedForeground} />
      <Rect x={112} y={198} width={92} height={7} rx={3.5} fill={tokens.mutedForeground} opacity={0.6} />

      {/* The grader, checking it */}
      <G>
        <Circle cx={238} cy={88} r={40} fill={tokens.primary} />
        <Circle cx={224} cy={82} r={5.5} fill={tokens.primaryForeground} />
        <Circle cx={252} cy={82} r={5.5} fill={tokens.primaryForeground} />
        <Path
          d="M222 102 Q238 114 254 102"
          stroke={tokens.primaryForeground}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d="M238 44 L242 56 L254 60 L242 64 L238 76 L234 64 L222 60 L234 56 Z"
          fill={tokens.accent}
        />
      </G>
    </Svg>
  );
}

/** Come back tomorrow: the streak. */
export function StreakIllustration({ width = 280, scheme = 'light', ...props }: IllustrationProps) {
  const tokens = themeTokens(scheme);
  const frame = useFrame(width);

  return (
    <Svg {...frame} {...props}>
      <Defs>
        <LinearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={tokens.streak} />
          <Stop offset="1" stopColor={tokens.warning} />
        </LinearGradient>
      </Defs>

      <Circle cx={160} cy={112} r={98} fill={tokens.streak} opacity={0.14} />

      {/* Flame */}
      <Path
        d="M160 36 C186 74 206 90 206 122 C206 152 186 174 160 174 C134 174 114 152 114 122 C114 96 132 84 142 62 C150 82 152 92 160 100 C166 88 162 62 160 36 Z"
        fill="url(#flame)"
      />
      <Path
        d="M160 92 C172 110 178 118 178 132 C178 146 170 156 160 156 C150 156 142 146 142 132 C142 118 148 110 160 92 Z"
        fill={tokens.background}
        opacity={0.75}
      />

      {/* Seven days, the last one still to earn */}
      <G>
        {[0, 1, 2, 3, 4, 5, 6].map((index) => {
          const x = 44 + index * 39;
          const done = index < 5;
          return (
            <G key={index}>
              <Rect
                x={x}
                y={196}
                width={28}
                height={28}
                rx={10}
                fill={done ? tokens.streak : tokens.muted}
                stroke={index === 5 ? tokens.streak : 'none'}
                strokeWidth={2}
                strokeDasharray={index === 5 ? '4 4' : undefined}
              />
              {done ? (
                <Path
                  d={`M${x + 8} 210 L${x + 12} 215 L${x + 21} 205`}
                  stroke={tokens.background}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ) : null}
            </G>
          );
        })}
      </G>
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
