import type { PlotlyFigure } from "../convex/lib/notebook";

const palette = [
  "#94638c",
  "#6484ac",
  "#578d7d",
  "#c38368",
  "#8a7cab",
  "#b86b87",
];
const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const axisKeys = [
  "xaxis",
  "yaxis",
  "xaxis2",
  "yaxis2",
  "xaxis3",
  "yaxis3",
  "xaxis4",
  "yaxis4",
] as const;

export function styleChart(
  figure: PlotlyFigure,
  {
    preview = false,
    embedded = false,
    focused = false,
    fill = false,
    height,
  }: {
    preview?: boolean;
    embedded?: boolean;
    focused?: boolean;
    fill?: boolean;
    height?: number;
  } = {},
) {
  // Plotly mutates its inputs. Styling must never alter the saved artifact.
  const copy = structuredClone(figure);
  const data = copy.data.map((trace) => {
    const styled = { ...trace } as Partial<Plotly.PlotData>;
    // Only remap the unnamed Plotly Express default. Explicit series colors
    // (including per-point status colors) retain their meaning.
    if (copy.data.length === 1 && !trace.name) {
      if (
        typeof trace.marker?.color === "string" &&
        trace.marker.color.toLowerCase() === "#636efa"
      )
        styled.marker = { ...trace.marker, color: palette[0] };
      if (trace.line?.color?.toLowerCase() === "#636efa")
        styled.line = { ...trace.line, color: palette[0] };
    }
    if (trace.type === "scatter") {
      styled.line = { width: 2.5, ...styled.line };
      styled.marker = {
        size: 6,
        ...styled.marker,
        line: { width: 1.5, color: "#ffffff" },
      };
    }
    if (trace.type === "bar") {
      styled.marker = { ...styled.marker, line: { width: 0 } };
      // Sparse count charts can carry their values directly. Leave custom text,
      // units, grouped/stacked series, and dense charts to their existing labels.
      if (
        !preview &&
        copy.data.length === 1 &&
        trace.orientation !== "h" &&
        (!trace.yaxis || trace.yaxis === "y") &&
        !trace.text &&
        !copy.layout?.yaxis?.tickformat &&
        trace.y?.length &&
        trace.y.length <= 10 &&
        trace.y.every(
          (value) =>
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 0 &&
            value < 1_000_000,
        )
      ) {
        styled.text = trace.y.map(String);
        styled.textposition = "outside";
        styled.textfont = { family: font, size: 11, color: "#6e5270" };
        styled.cliponaxis = false;
      }
    }
    return styled;
  });
  const hasSubplots = axisKeys.slice(2).some((key) => !!copy.layout?.[key]);
  // Plotly 4 supports barcornerradius; its separate type package omits it.
  // https://plotly.com/javascript/reference/layout/#layout-barcornerradius
  const layout: Partial<Plotly.Layout> & { barcornerradius?: number } = {
    ...copy.layout,
    autosize: true,
    clickmode: "event+select",
    title:
      embedded || preview
        ? undefined
        : {
            ...copy.layout?.title,
            font: { family: font, size: 14, color: "#322d39" },
            x: 0.04,
            xanchor: "left",
          },
    height: preview
      ? 152
      : fill
        ? undefined
        : (height ?? (hasSubplots ? 520 : focused ? 480 : 300)),
    margin: preview
      ? { t: 14, r: 12, b: 26, l: 34 }
      : {
          t: hasSubplots ? 48 : !embedded && copy.layout?.title ? 60 : 30,
          r: 24,
          b: 54,
          l: 54,
        },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: font, color: "#746e7b", size: preview ? 9 : 11 },
    colorway: palette,
    ...(copy.data.some((trace) => trace.type === "bar") &&
    !copy.data.some((trace) => trace.type === "histogram")
      ? {
          bargap: copy.layout?.bargap ?? 0.38,
          barcornerradius: preview ? 3 : 5,
        }
      : {}),
    hoverlabel: {
      bgcolor: "#ffffff",
      bordercolor: "#e7e2eb",
      font: { family: font, size: 12, color: "#322d39" },
      align: "left",
      namelength: -1,
    },
    legend: {
      orientation: "h",
      y: hasSubplots ? -0.15 : -0.25,
      x: 0,
      xanchor: "left",
      font: { family: font, size: 11, color: "#746e7b" },
      bgcolor: "rgba(255,255,255,0)",
    },
    ...(preview ? { showlegend: false } : {}),
  };
  for (const key of axisKeys) {
    const source = copy.layout?.[key];
    if (!source && key !== "xaxis" && key !== "yaxis") continue;
    const vertical = key.startsWith("y");
    layout[key] = {
      automargin: true,
      showgrid: vertical,
      zeroline: true,
      ...source,
      gridcolor: "#efedf2",
      gridwidth: 1,
      griddash: "dot",
      zerolinecolor: "#e7e3eb",
      zerolinewidth: 1,
      showline: false,
      ticks: "",
      tickfont: { family: font, size: preview ? 9 : 11, color: "#7b7382" },
      title: preview
        ? undefined
        : source?.title
          ? {
              ...source.title,
              standoff: 14,
              font: { family: font, size: 11, color: "#79717f" },
            }
          : undefined,
      ...(preview ? { showgrid: false, zeroline: false, nticks: 3 } : {}),
    };
  }
  return { data, layout };
}
