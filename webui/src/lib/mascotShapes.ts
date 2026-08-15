import { SHAPE, type CursorShape } from "@/components/CursorAvatar";

export const MASCOT_SHAPES = [
  "cursor",
  "circle",
  "oval",
  "square",
  "pill",
  "triangle",
  "hexagon",
  "cloud",
  "drop",
] as const;

export type MascotShape = (typeof MASCOT_SHAPES)[number];

const BOX = 114.2705;

const simple = (name: Exclude<MascotShape, "cursor">, body: string): CursorShape => ({
  name,
  fit: "",
  body,
  clip: body.replace(/ fill="\{\{GRADIENT\}\}"/g, ""),
  anchor: { x: BOX, y: BOX, scale: 0.86 },
});

const SHAPES: Record<Exclude<MascotShape, "cursor">, CursorShape> = {
  circle: simple("circle", '<circle cx="114.2705" cy="114.2705" r="96" fill="{{GRADIENT}}"/>'),
  oval: simple("oval", '<ellipse cx="114.2705" cy="114.2705" rx="103" ry="82" fill="{{GRADIENT}}"/>'),
  square: simple("square", '<rect x="24" y="24" width="180" height="180" rx="38" fill="{{GRADIENT}}"/>'),
  pill: simple("pill", '<rect x="12" y="64" width="204" height="100" rx="50" fill="{{GRADIENT}}"/>'),
  triangle: simple("triangle", '<path d="M114 16 214 204H14Z" fill="{{GRADIENT}}"/>'),
  hexagon: simple("hexagon", '<path d="m57 20 114 0 57 94-57 94H57L0 114Z" transform="translate(0 0)" fill="{{GRADIENT}}"/>'),
  cloud: simple("cloud", '<path d="M48 190h126c30 0 45-19 45-40 0-23-18-40-42-40-8-32-31-51-63-51-34 0-60 23-66 56-26 0-45 17-45 39 0 21 18 36 45 36Z" transform="translate(0 -2)" fill="{{GRADIENT}}"/>'),
  drop: simple("drop", '<path d="M114 12C94 44 45 83 45 133c0 43 30 70 69 70s69-27 69-70c0-50-49-89-69-121Z" fill="{{GRADIENT}}"/>'),
};

export function mascotShape(value: string | null | undefined): CursorShape {
  return value && value !== "cursor" && value in SHAPES
    ? SHAPES[value as Exclude<MascotShape, "cursor">]
    : SHAPE;
}
