export interface Point { x: number; y: number; }

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
  color: string;
  /** Optional quadratic bezier control point for curved walls */
  curvePoint?: Point;
  texture?: string;
  /** Interior-specific overrides (if different from exterior) */
  interiorColor?: string;
  interiorTexture?: string;
  /** Exterior-specific overrides */
  exteriorColor?: string;
  exteriorTexture?: string;
}

export type RoomCategory = 'indoor' | 'outdoor' | 'garage' | 'utility';

export interface Room {
  id: string;
  name: string;
  walls: string[];
  floorTexture: string;
  area: number;
  color?: string;
  roomType?: RoomCategory;
  /** Custom label position offset from centroid (in world units) */
  labelOffset?: Point;
}

export interface Door {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  type: 'single' | 'double' | 'sliding' | 'french' | 'pocket' | 'bifold' | 'opening' | 'garage';
  swingDirection: 'left' | 'right';
  flipSide: boolean; // flip which side of wall the door opens to (vertical flip)
}

export interface Window {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  sillHeight: number;
  type: 'standard' | 'fixed' | 'casement' | 'sliding' | 'bay';
}

export interface FurnitureItem {
  id: string;
  catalogId: string;
  position: Point;
  rotation: number;
  scale: { x: number; y: number; z: number };
  // Per-item overrides (optional — falls back to catalog defaults)
  color?: string;
  width?: number;   // cm
  depth?: number;   // cm
  height?: number;  // cm
  material?: string; // material name/id
  locked?: boolean;
}

export interface ElementGroup {
  id: string;
  elementIds: string[];
}

export type StairType = 'straight' | 'l-shaped' | 'u-shaped' | 'spiral';

export interface Stair {
  id: string;
  position: Point;
  rotation: number;
  width: number;   // default 100cm
  depth: number;   // default 300cm
  riserCount: number; // default 14
  direction: 'up' | 'down';
  stairType: StairType; // default 'straight'
}

export interface Column {
  id: string;
  position: Point;
  rotation: number;
  shape: 'round' | 'square';
  diameter: number;  // cm (for round) or side length (for square)
  height: number;    // cm
  color: string;
}

export interface Measurement {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Annotation {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  offset: number; // perpendicular offset for dimension line (default 40)
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number; // world coordinate (x for vertical, y for horizontal)
}

/** What a completed scale calibration recorded, so it can be shown and redone (HP-303). */
export interface ReferenceCalibration {
  /** The real-world distance the user entered, in cm. */
  knownDistanceCm: number;
  /** The two points they clicked, in world coordinates at the time of calibration. */
  pointA: Point;
  pointB: Point;
  /** ISO timestamp, so the properties panel can say when the scale was last set. */
  calibratedAt: string;
}

export interface BackgroundImage {
  dataUrl: string;
  position: Point;
  scale: number;
  opacity: number;
  rotation: number;
  locked: boolean;
  /** Present once the reference has been calibrated against a known dimension. */
  calibration?: ReferenceCalibration;
  /** Original file name, shown in the properties panel. */
  sourceName?: string;
  /**
   * Line work extracted from a vector PDF, in the reference image's **pixel** space, used as
   * snap targets while tracing (HP-304). Pixel space rather than world space so the targets
   * stay attached to the drawing through calibration, panning and rotation.
   */
  snapSegments?: { x1: number; y1: number; x2: number; y2: number }[];
}

/** A placed 2D entourage symbol (person, car, tree, …) for presentation plans */
export interface EntourageItem {
  id: string;
  defId: string; // id of a built-in EntourageDef or a project CustomEntourageDef
  position: Point; // center, world cm
  width: number; // real-world width in cm
  rotation: number; // degrees
  opacity?: number; // 0–1, default 1
  locked?: boolean;
}

/** User-uploaded PNG entourage symbol, stored on the project */
export interface CustomEntourageDef {
  id: string;
  name: string;
  dataUrl: string; // PNG as data URL
  aspect: number; // height / width
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  furniture: FurnitureItem[];
  stairs: Stair[];
  columns: Column[];
  backgroundImage?: BackgroundImage;
  guides: GuideLine[];
  measurements: Measurement[];
  annotations: Annotation[];
  textAnnotations: TextAnnotation[];
  groups: ElementGroup[];
  entourage?: EntourageItem[];
}

export interface Project {
  /** Persisted schema version. Set by the project factory and the load pipeline —
   *  see src/lib/persistence/schema.ts. UI code should never read this. */
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  floors: Floor[];
  activeFloorId: string;
  createdAt: Date;
  updatedAt: Date;
  customEntourage?: CustomEntourageDef[];
}
