import type { Coordinate, SearchTrace } from "../types";

const METERS_PER_DEGREE = 111_320;

/** Keep the animation on routed geometry, even when a route enters or leaves the local view. */
export function destinationSearchTraces(traces: SearchTrace[], destination: Coordinate, radius = 1_150): SearchTrace[] {
  const longitudeScale = METERS_PER_DEGREE * Math.cos(destination[1] * Math.PI / 180);
  const project = (point: Coordinate): Coordinate => [
    (point[0] - destination[0]) * longitudeScale,
    (point[1] - destination[1]) * METERS_PER_DEGREE,
  ];
  const distanceSquared = (point: Coordinate) => {
    const [x, y] = project(point);
    return x * x + y * y;
  };
  // Pedestrian traces radiate from the destination and arrive before the longer car routes.
  const walking = traces.filter((trace) => trace.id.startsWith("walk:"));
  const source = walking.length ? walking : traces;
  return source.flatMap((trace) => {
    if (trace.geometry.coordinates.length < 2) return [];
    const original = trace.geometry.coordinates;
    const coordinates = distanceSquared(original[0]) <= distanceSquared(original.at(-1)!)
      ? original : [...original].reverse();
    const sections: Coordinate[][] = [];
    let section: Coordinate[] = [];
    for (let index = 1; index < coordinates.length; index++) {
      const from = coordinates[index - 1], to = coordinates[index];
      const [x, y] = project(from), [endX, endY] = project(to);
      const dx = endX - x, dy = endY - y;
      const a = dx * dx + dy * dy;
      if (!a) continue;
      const b = 2 * (x * dx + y * dy), c = x * x + y * y - radius * radius;
      const discriminant = b * b - 4 * a * c;
      let start = 0, end = 1;
      if (discriminant < 0) {
        if (c > 0) continue;
      } else {
        const root = Math.sqrt(discriminant);
        start = Math.max(0, (-b - root) / (2 * a));
        end = Math.min(1, (-b + root) / (2 * a));
        if (start >= end) continue;
      }
      const interpolate = (fraction: number): Coordinate => [
        from[0] + (to[0] - from[0]) * fraction,
        from[1] + (to[1] - from[1]) * fraction,
      ];
      const clippedStart = interpolate(start), clippedEnd = interpolate(end);
      const last = section.at(-1);
      if (last && Math.hypot(last[0] - clippedStart[0], last[1] - clippedStart[1]) > 1e-8) {
        if (section.length > 1) sections.push(section);
        section = [];
      }
      if (!section.length) section.push(clippedStart);
      section.push(clippedEnd);
      if (end < 1) {
        sections.push(section);
        section = [];
      }
    }
    if (section.length > 1) sections.push(section);
    return sections.map((points, index) => ({
      id: `local:${trace.id}:${index}`,
      geometry: { type: "LineString" as const, coordinates: points },
    }));
  });
}
