import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;

type ChartValue = number | string | Array<number | string>;

type ChartPayloadItem = {
  color?: string;
  dataKey?: string | number;
  fill?: string;
  name?: string | number;
  payload?: Record<string, unknown>;
  type?: string;
  value?: ChartValue;
};

type ChartLegendItem = {
  color?: string;
  dataKey?: string | number;
  type?: string;
  value?: string | number;
};

type TooltipFormatter = (
  value: ChartValue,
  name: string | number,
  item: ChartPayloadItem,
  index: number,
  payload: ChartPayloadItem[]
) => React.ReactNode;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  );
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringOrNumber = (value: unknown): string | number | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getKeyString = (value: unknown, fallback = "value"): string => {
  const primitive = getStringOrNumber(value);
  return primitive === undefined ? fallback : String(primitive);
};

const isChartPayloadItem = (value: unknown): value is ChartPayloadItem => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    "type" in value &&
    value.type !== undefined &&
    typeof value.type !== "string"
  ) {
    return false;
  }

  if (
    "name" in value &&
    value.name !== undefined &&
    getStringOrNumber(value.name) === undefined
  ) {
    return false;
  }

  if (
    "dataKey" in value &&
    value.dataKey !== undefined &&
    getStringOrNumber(value.dataKey) === undefined
  ) {
    return false;
  }

  if (
    "payload" in value &&
    value.payload !== undefined &&
    !isRecord(value.payload)
  ) {
    return false;
  }

  return true;
};

const isChartLegendItem = (value: unknown): value is ChartLegendItem => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    "type" in value &&
    value.type !== undefined &&
    typeof value.type !== "string"
  ) {
    return false;
  }

  return true;
};

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme || itemConfig.color
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const themeKey = theme as keyof typeof THEMES;
    const color = itemConfig.theme?.[themeKey] || itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<"div"> & {
  active?: boolean;
  color?: string;
  formatter?: TooltipFormatter;
  hideIndicator?: boolean;
  hideLabel?: boolean;
  indicator?: "line" | "dot" | "dashed";
  label?: string | number;
  labelClassName?: string;
  labelFormatter?: (
    value: React.ReactNode,
    payload: ChartPayloadItem[]
  ) => React.ReactNode;
  labelKey?: string;
  nameKey?: string;
  payload?: unknown[];
}) {
  const { config } = useChart();
  const typedPayload = React.useMemo(
    () => (Array.isArray(payload) ? payload.filter(isChartPayloadItem) : []),
    [payload]
  );

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !typedPayload.length) {
      return null;
    }

    const [item] = typedPayload;
    const key = getKeyString(
      labelKey ?? item.dataKey ?? item.name,
      "value"
    );
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string"
        ? config[label]?.label ?? label
        : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value, typedPayload)}
        </div>
      );
    }

    if (!value) {
      return null;
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [
    label,
    labelFormatter,
    typedPayload,
    hideLabel,
    labelClassName,
    config,
    labelKey,
  ]);

  if (!active || !typedPayload.length) {
    return null;
  }

  const nestLabel = typedPayload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {typedPayload
          .filter(item => item.type !== "none")
          .map((item, index) => {
            const key = getKeyString(nameKey ?? item.name ?? item.dataKey);
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor =
              color ?? getString(item.payload?.fill) ?? item.color;
            const style = {
              "--color-bg": indicatorColor,
              "--color-border": indicatorColor,
            } as React.CSSProperties &
              Record<"--color-bg" | "--color-border", string | undefined>;
            const itemName = getStringOrNumber(item.name);

            return (
              <div
                key={getKeyString(item.dataKey ?? item.name, String(index))}
                className={cn(
                  "[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item.value !== undefined && itemName !== undefined ? (
                  formatter(item.value, itemName, item, index, typedPayload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            }
                          )}
                          style={style}
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label ?? itemName}
                        </span>
                      </div>
                      {item.value !== undefined && (
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  hideIcon?: boolean;
  nameKey?: string;
  payload?: unknown[];
  verticalAlign?: "top" | "bottom";
}) {
  const { config } = useChart();
  const typedPayload = React.useMemo(
    () => (Array.isArray(payload) ? payload.filter(isChartLegendItem) : []),
    [payload]
  );

  if (!typedPayload.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {typedPayload
        .filter(item => item.type !== "none")
        .map((item, index) => {
          const key = getKeyString(nameKey ?? item.dataKey);
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={getKeyString(item.value ?? item.dataKey, String(index))}
              className={cn(
                "[&>svg]:text-muted-foreground flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (!isRecord(payload)) {
    return undefined;
  }

  const nestedPayload = isRecord(payload.payload) ? payload.payload : undefined;

  let configLabelKey = key;

  const payloadValue = payload[key];
  if (typeof payloadValue === "string") {
    configLabelKey = payloadValue;
  } else if (nestedPayload) {
    const nestedPayloadValue = nestedPayload[key];
    if (typeof nestedPayloadValue === "string") {
      configLabelKey = nestedPayloadValue;
    }
  }

  return config[configLabelKey] ?? config[key];
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
