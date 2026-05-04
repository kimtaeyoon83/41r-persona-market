"use client";

import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface RadarChartProps {
  data: Record<string, number>;
  title: string;
  color: string;
}

export function RadarChart({ data, title, color }: RadarChartProps) {
  const chartData = Object.entries(data).map(([key, value]) => ({
    axis: key.replace(/_/g, " "),
    value: Math.round(value * 100),
    fullMark: 100,
  }));

  return (
    <div className="p-5 rounded-xl bg-surface border border-border-dim">
      <h3 className="text-sm font-mono font-medium mb-3" style={{ color }}>
        {title}
      </h3>
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsRadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
            <PolarGrid stroke="#1E2230" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "#8A8F9E", fontSize: 11 }}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: "#555B6E", fontSize: 10 }}
              tickCount={5}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#151822",
                border: "1px solid #282D3E",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#E8E9ED",
                fontFamily: "JetBrains Mono, monospace",
              }}
              formatter={(value: number | undefined) => [`${value ?? 0}%`, "Score"]}
            />
            <Radar
              name={title}
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{
                r: 3,
                fill: color,
                stroke: color,
                strokeWidth: 1,
              }}
            />
          </RechartsRadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
