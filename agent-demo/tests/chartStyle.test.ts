import { describe, expect, it } from "vitest";
import { styleChart } from "../src/chartStyle";
import type { PlotlyFigure } from "../convex/lib/notebook";

describe("chart styling preserves analytical meaning", () => {
  it("isolates Plotly mutations from the saved figure and retains exact values", () => {
    const figure: PlotlyFigure = {
      data: [
        {
          type: "bar",
          x: ["Mon", "Tue"],
          y: [22, 24],
          marker: { color: "#636efa" },
        },
      ],
      layout: {
        yaxis: { title: { text: "Orders" }, range: [0, 30] },
        bargap: 0.2,
      },
    };
    const original = structuredClone(figure);
    const result = styleChart(figure);
    expect(result.data[0].x).toEqual(figure.data[0].x);
    expect(result.data[0].y).toEqual(figure.data[0].y);
    expect(result.layout.yaxis?.range).toEqual([0, 30]);
    expect(result.layout.bargap).toBe(0.2);
    (result.data[0] as Plotly.PlotData).y = [0];
    result.layout.yaxis!.title!.text = "Changed by renderer";
    expect(figure).toEqual(original);
  });
  it("preserves named colors, per-point colors, gaps and stacked data", () => {
    const figure: PlotlyFigure = {
      data: [
        {
          type: "bar",
          name: "Success",
          marker: { color: "green" },
          y: [10, 12],
        },
        {
          type: "bar",
          name: "Failure",
          marker: { color: ["red", "orange"] },
          y: [2, 1],
        },
      ],
      layout: { barmode: "stack", bargap: 0, showlegend: true },
    };
    const { data, layout } = styleChart(figure);
    expect(data.map((d) => (d as Plotly.PlotData).marker.color)).toEqual([
      "green",
      ["red", "orange"],
    ]);
    expect(data.map((d) => d.y)).toEqual([
      [10, 12],
      [2, 1],
    ]);
    expect(layout.barmode).toBe("stack");
    expect(layout.bargap).toBe(0);
    expect(layout.showlegend).toBe(true);
    expect(data.map((d) => d.text)).toEqual([undefined, undefined]);
  });
  it("retains subplot domains, axis bindings, logarithmic scales and unit formats", () => {
    const figure: PlotlyFigure = {
      data: [
        {
          type: "scatter",
          xaxis: "x2",
          yaxis: "y2",
          x: [1, 2],
          y: [100, 200],
          mode: "lines",
          line: { shape: "hv", width: 4, color: "blue" },
        },
      ],
      layout: {
        xaxis2: { domain: [0.5, 1], anchor: "y2", matches: "x" },
        yaxis2: {
          title: { text: "Revenue" },
          type: "log",
          range: [1, 4],
          tickformat: "$,.0f",
          overlaying: "y",
          side: "right",
          showgrid: false,
        },
      },
    };
    const { data, layout } = styleChart(figure, { preview: true });
    expect(data[0]).toMatchObject(figure.data[0]);
    expect(layout.xaxis2).toMatchObject(figure.layout!.xaxis2!);
    expect(layout.yaxis2).toMatchObject({
      type: "log",
      range: [1, 4],
      tickformat: "$,.0f",
      overlaying: "y",
      side: "right",
      showgrid: false,
    });
    expect(layout.yaxis2?.title).toBeUndefined();
    expect(layout.yaxis3).toBeUndefined();
  });
  it("does not replace custom labels or label formatted, fractional, secondary-axis or dense data", () => {
    const base: PlotlyFigure = {
      data: [{ type: "bar", y: [10, 20], text: ["A", "B"] }],
    };
    expect(styleChart(base).data[0].text).toEqual(["A", "B"]);
    for (const figure of [
      {
        data: [{ type: "bar", y: [10, 20] }],
        layout: { yaxis: { tickformat: "$,.0f" } },
      },
      { data: [{ type: "bar", y: [0.2, 1.3] }] },
      { data: [{ type: "bar", y: [-2, 1] }] },
      { data: [{ type: "bar", yaxis: "y2", y: [10, 20] }] },
      { data: [{ type: "bar", y: Array.from({ length: 11 }, (_, i) => i) }] },
    ] as PlotlyFigure[])
      expect(styleChart(figure).data[0].text).toBeUndefined();
  });
  it("leaves histogram binning, normalization, and heatmap scales intact", () => {
    const figure: PlotlyFigure = {
      data: [
        {
          type: "histogram",
          x: [1, 1, 2, 5],
          nbinsx: 4,
          histnorm: "probability density",
        },
        {
          type: "heatmap",
          z: [
            [1, null],
            [3, 4],
          ],
          colorscale: "RdBu",
        },
      ],
    };
    const { data, layout } = styleChart(figure);
    expect(data).toEqual(figure.data);
    expect(layout.bargap).toBeUndefined();
    expect(layout.barcornerradius).toBeUndefined();
  });
});
