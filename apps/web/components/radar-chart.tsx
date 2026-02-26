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
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
      <h3 className="text-sm font-medium mb-2" style={{ color }}>
        {title}
      </h3>
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsRadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
            <PolarGrid stroke="#374151" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickCount={5}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#e5e7eb",
              }}
              formatter={(value: number | undefined) => [`${value ?? 0}%`, "Score"]}
            />
            <Radar
              name={title}
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.2}
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
