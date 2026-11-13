import { useId } from 'react';

type BeastKind = 'bull' | 'bear';

type BeastGlyphProps = {
  kind: BeastKind;
  animated?: boolean;
  transform?: string;
  flip?: boolean;
};

type BeastIconProps = {
  size?: number;
  animated?: boolean;
  className?: string;
  title?: string;
  flip?: boolean;
};

export function BeastGlyph({
  kind,
  animated = false,
  transform,
  flip = false,
}: BeastGlyphProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bull = kind === 'bull';
  const prefix = `${uid}-${kind}`;

  return (
    <g transform={transform}>
      <g transform={flip ? 'translate(96 0) scale(-1 1)' : undefined}>
        <g className={animated ? 'beast-roar' : undefined}>
          <defs>
            <radialGradient id={`${prefix}-head`} cx="34%" cy="22%" r="82%">
              {bull ? (
                <>
                  <stop offset="0%" stopColor="#b9f7c6" />
                  <stop offset="32%" stopColor="#63dc80" />
                  <stop offset="66%" stopColor="#25a746" />
                  <stop offset="100%" stopColor="#074a1d" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#ffb0a8" />
                  <stop offset="30%" stopColor="#fb5c52" />
                  <stop offset="65%" stopColor="#c8231d" />
                  <stop offset="100%" stopColor="#590806" />
                </>
              )}
            </radialGradient>

            <linearGradient id={`${prefix}-body`} x1="0%" y1="0%" x2="100%" y2="100%">
              {bull ? (
                <>
                  <stop offset="0%" stopColor="#2c9e47" />
                  <stop offset="55%" stopColor="#0d6727" />
                  <stop offset="100%" stopColor="#043813" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#d7372f" />
                  <stop offset="55%" stopColor="#94110d" />
                  <stop offset="100%" stopColor="#4b0504" />
                </>
              )}
            </linearGradient>

            <linearGradient id={`${prefix}-muzzle`} x1="10%" y1="0%" x2="90%" y2="100%">
              {bull ? (
                <>
                  <stop offset="0%" stopColor="#d8f7d9" />
                  <stop offset="40%" stopColor="#91dca2" />
                  <stop offset="100%" stopColor="#4f9c63" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#ffd6c5" />
                  <stop offset="42%" stopColor="#e9a08f" />
                  <stop offset="100%" stopColor="#a65b51" />
                </>
              )}
            </linearGradient>

            <linearGradient id={`${prefix}-horn`} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8c5c20" />
              <stop offset="30%" stopColor="#e8c985" />
              <stop offset="65%" stopColor="#fff1c9" />
              <stop offset="100%" stopColor="#b38845" />
            </linearGradient>

            <radialGradient id={`${prefix}-nose`} cx="32%" cy="24%" r="82%">
              <stop offset="0%" stopColor="#6d6a68" />
              <stop offset="30%" stopColor="#2d2928" />
              <stop offset="100%" stopColor="#0a0606" />
            </radialGradient>

            <linearGradient id={`${prefix}-mouth`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#320308" />
              <stop offset="55%" stopColor="#6c0a15" />
              <stop offset="100%" stopColor="#1d0204" />
            </linearGradient>

            <radialGradient id={`${prefix}-eye`} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffe69b" />
              <stop offset="45%" stopColor="#d69322" />
              <stop offset="100%" stopColor="#6d3a02" />
            </radialGradient>

            <radialGradient id={`${prefix}-shadow`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse cx="52" cy="88" rx="38" ry="7" fill={`url(#${prefix}-shadow)`} />

          {bull ? (
            <>
              <path
                d="M23 59C21 72 25 83 34 92H68C72 79 76 69 76 58C63 69 39 71 23 59Z"
                fill={`url(#${prefix}-body)`}
              />
              <path
                d="M29 65L23 76L32 74L27 84L39 79L38 89L49 82L52 91L60 82L64 91L71 78L78 82L73 69L80 65L72 58C60 67 42 68 29 65Z"
                fill={bull ? '#075420' : '#640b08'}
                opacity="0.85"
              />
              <path
                d="M49 17C54 8 62 3 71 3C65 10 63 16 65 23C59 17 54 15 49 17Z"
                fill={`url(#${prefix}-horn)`}
                stroke="#7a5422"
                strokeWidth="0.8"
              />
              <path
                d="M26 31C16 27 9 32 11 40C16 42 22 36 29 35Z"
                fill="#0b5e25"
                stroke="#043c16"
                strokeWidth="0.8"
              />
              <path
                d="M20 35C16 34 13 36 14 39C17 39 19 37 22 37Z"
                fill="#b36d70"
                opacity="0.8"
              />
              <path
                d="M18 38C16 24 28 14 44 15C58 16 68 24 71 34L74 50C75 58 70 64 61 65C52 66 46 62 38 66C26 72 18 62 17 50Z"
                fill={`url(#${prefix}-head)`}
                stroke="#064b1d"
                strokeWidth="1.1"
              />
              <path
                d="M20 45C22 56 31 65 43 65C36 59 30 51 28 41C25 41 22 43 20 45Z"
                fill="#063f18"
                opacity="0.32"
              />
              <path
                d="M22 33C26 21 36 17 47 18"
                fill="none"
                stroke="#d2ffe0"
                strokeWidth="1.7"
                strokeLinecap="round"
                opacity="0.38"
              />
              <path
                d="M29 20C20 16 13 10 12 4C19 7 27 12 34 18Z"
                fill={`url(#${prefix}-horn)`}
                stroke="#7a5422"
                strokeWidth="0.9"
                strokeLinejoin="round"
              />
              <path
                d="M31 21C24 17 18 12 15 7"
                fill="none"
                stroke="#fff7dc"
                strokeWidth="1.1"
                strokeLinecap="round"
                opacity="0.55"
              />
            </>
          ) : (
            <>
              <path
                d="M22 59C20 73 25 84 35 92H69C73 80 77 70 77 58C64 69 39 71 22 59Z"
                fill={`url(#${prefix}-body)`}
              />
              <path
                d="M27 66L21 77L31 75L26 85L39 80L38 90L50 83L53 92L61 82L66 91L72 78L79 83L73 68L81 64L73 57C60 67 40 68 27 66Z"
                fill="#5c0907"
                opacity="0.9"
              />
              <circle cx="51" cy="21" r="10" fill="#6d0b08" stroke="#3f0302" strokeWidth="1" />
              <circle cx="51" cy="21" r="5.8" fill="#2f0302" />
              <circle cx="26" cy="27" r="13" fill={`url(#${prefix}-head)`} stroke="#5b0705" strokeWidth="1" />
              <circle cx="26" cy="27" r="7.2" fill="#4b0504" />
              <circle cx="26" cy="27" r="4" fill="#c4655e" opacity="0.65" />
              <path
                d="M16 40C14 24 28 13 45 15C58 17 68 25 71 35L74 49C75 59 69 65 60 66C50 67 44 62 36 66C24 72 16 62 15 50Z"
                fill={`url(#${prefix}-head)`}
                stroke="#5b0705"
                strokeWidth="1.1"
              />
              <path
                d="M18 47C21 58 31 66 43 66C35 60 29 52 27 42C24 43 21 44 18 47Z"
                fill="#3f0302"
                opacity="0.3"
              />
              <path
                d="M20 36C25 23 36 18 48 19"
                fill="none"
                stroke="#ffd6cf"
                strokeWidth="1.7"
                strokeLinecap="round"
                opacity="0.34"
              />
              <path
                d="M29 62L23 72L33 69L29 79L40 74L39 84L49 77L52 85L60 74L67 80L68 68C58 69 42 68 29 62Z"
                fill="#2f0302"
                opacity="0.55"
              />
            </>
          )}

          <path
            d="M56 39C65 35 77 36 84 41C90 45 91 52 87 57C81 63 70 64 61 60C54 57 52 48 56 39Z"
            fill={`url(#${prefix}-muzzle)`}
            stroke={bull ? '#2e7440' : '#8b463d'}
            strokeWidth="0.9"
          />
          <path
            d="M58 43C66 39 77 40 83 44"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.3"
            strokeLinecap="round"
            opacity="0.3"
          />

          <path
            d="M77 43C82 42 88 44 90 48C92 53 88 57 82 57C77 57 74 54 74 50C74 47 75 44 77 43Z"
            fill={`url(#${prefix}-nose)`}
            stroke="#080404"
            strokeWidth="0.8"
          />
          <ellipse cx="84" cy="49" rx="2.2" ry="1.5" fill="#080404" />
          <path
            d="M79 45C80 44 82 44 83 45"
            fill="none"
            stroke="#a7a3a1"
            strokeWidth="0.9"
            strokeLinecap="round"
            opacity="0.7"
          />

          <path
            d="M40 31C45 27 52 27 57 31C54 36 47 38 41 35C40 34 39 32 40 31Z"
            fill="#f7e9c8"
          />
          <circle cx="49" cy="32" r="3.5" fill={`url(#${prefix}-eye)`} />
          <ellipse cx="49.7" cy="32" rx="1.1" ry="2.4" fill="#120805" />
          <circle cx="48.4" cy="30.7" r="0.9" fill="#ffffff" opacity="0.9" />
          <path
            d="M40 29C45 24 53 24 58 29"
            fill="none"
            stroke={bull ? '#043615' : '#3c0403'}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M42 38C46 41 51 42 55 40"
            fill="none"
            stroke={bull ? '#0a4c20' : '#650a07'}
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.55"
          />

          <path
            d="M59 55C68 57 79 57 87 54C83 65 73 75 61 72C55 69 54 61 59 55Z"
            fill={`url(#${prefix}-mouth)`}
          />
          <path
            d="M61 58L64 64L67 58Z"
            fill="#fff9ea"
          />
          <path
            d="M71 58L74 65L77 58Z"
            fill="#fff9ea"
          />
          <path
            d="M80 57L82 63L85 56Z"
            fill="#fff9ea"
          />

          <g className={animated ? 'beast-jaw' : undefined}>
            <path
              d="M59 60C68 64 79 62 85 57C83 69 74 78 62 77C56 75 55 68 59 60Z"
              fill={bull ? '#45b85c' : '#ea4a41'}
              stroke={bull ? '#075d25' : '#7d0a07'}
              strokeWidth="1"
            />
            <path
              d="M64 65C70 65 78 63 83 59C80 68 74 72 67 71C63 70 62 67 64 65Z"
              fill={bull ? '#ff7d88' : '#ff9a9d'}
            />
            <path
              d="M64 61L66 68L69 61Z"
              fill="#fff9ea"
            />
            <path
              d="M75 61L78 69L81 59Z"
              fill="#fff9ea"
            />
            <path
              d="M61 71C68 74 78 73 84 66"
              fill="none"
              stroke={bull ? '#95e3a5' : '#ffb3ad'}
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.55"
            />
          </g>

          {bull ? (
            <>
              <path
                d="M27 58C31 62 35 64 41 64"
                fill="none"
                stroke="#8af0a0"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.35"
              />
              <path
                d="M31 23C28 24 26 27 25 30M35 21C32 22 30 25 29 28M39 20C36 22 34 24 33 27"
                fill="none"
                stroke="#0a5a25"
                strokeWidth="0.8"
                strokeLinecap="round"
                opacity="0.55"
              />
            </>
          ) : (
            <>
              <path
                d="M29 57C33 61 37 63 42 64"
                fill="none"
                stroke="#ffb0a8"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.35"
              />
              <path
                d="M31 26C28 27 26 30 25 33M36 23C33 24 31 27 30 30M41 22C38 24 36 26 35 29"
                fill="none"
                stroke="#6d0b08"
                strokeWidth="0.9"
                strokeLinecap="round"
                opacity="0.5"
              />
            </>
          )}
        </g>
      </g>
    </g>
  );
}

function BeastIcon({
  kind,
  size = 16,
  animated = false,
  className,
  title,
  flip = false,
}: BeastIconProps & { kind: BeastKind }) {
  const labelled = Boolean(title);
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      className={className}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <BeastGlyph kind={kind} animated={animated} flip={flip} />
    </svg>
  );
}

export function BullIcon(props: BeastIconProps) {
  return <BeastIcon kind="bull" {...props} />;
}

export function BearIcon(props: BeastIconProps) {
  return <BeastIcon kind="bear" {...props} />;
}
