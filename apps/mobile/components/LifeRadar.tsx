import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { colors } from '@/constants/theme';

type PillarStat = {
  id: string;
  name: string;
  level: number;
  is_priority: boolean;
};

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;
const MAX_R = 95;
const LABEL_OFFSET = 24;
const MAX_LEVEL = 50;
const MAX_LABEL = 8; // trunca nomes longos para caber no radar
const GRIDS = [0.25, 0.5, 0.75, 1] as const;

function xy(angle: number, r: number) {
  return {
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  };
}

function gridPoints(n: number, scale: number): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const { x, y } = xy(a, MAX_R * scale);
    return `${x},${y}`;
  }).join(' ');
}

export default function LifeRadar({ pillars }: { pillars: PillarStat[] }) {
  if (pillars.length < 3) return null;

  const n = pillars.length;

  const dataPoints = pillars.map((p, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = (p.level / MAX_LEVEL) * MAX_R;
    return xy(a, r);
  });

  const dataPolygon = dataPoints.map(({ x, y }) => `${x},${y}`).join(' ');

  return (
    <Svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      accessibilityLabel="Radar de pilares de vida"
    >
      {/* Grade */}
      {GRIDS.map((s) => (
        <Polygon
          key={s}
          points={gridPoints(n, s)}
          fill="none"
          stroke={colors.border}
          strokeWidth="1"
        />
      ))}

      {/* Eixos */}
      {pillars.map((_, i) => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const { x, y } = xy(a, MAX_R);
        return (
          <Line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke={colors.border}
            strokeWidth="1"
          />
        );
      })}

      {/* Área de dados */}
      <Polygon
        points={dataPolygon}
        fill={colors.accent}
        fillOpacity="0.18"
        stroke={colors.accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Pontos */}
      {dataPoints.map(({ x, y }, i) => (
        <Circle key={i} cx={x} cy={y} r="3.5" fill={colors.accent} />
      ))}

      {/* Labels */}
      {pillars.map((p, i) => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const { x, y } = xy(a, MAX_R + LABEL_OFFSET);
        const anchor =
          Math.abs(x - CX) < 5 ? 'middle' : x < CX ? 'end' : 'start';
        return (
          <SvgText
            key={p.id}
            x={x}
            y={y}
            textAnchor={anchor}
            alignmentBaseline="middle"
            fontSize="11"
            fill={p.is_priority ? colors.accent : colors.textSecondary}
          >
            {p.name.length > MAX_LABEL ? p.name.slice(0, MAX_LABEL) + '…' : p.name}
          </SvgText>
        );
      })}
    </Svg>
  );
}
