export type CandidateState = "pending" | "green" | "yellow" | "red";

export interface GeoCoordinate {
  readonly lat: number;
  readonly lng: number;
}

export interface ResearchReason {
  readonly summary: string;
  readonly officialUrl?: string;
}

export interface ResearchCandidate {
  readonly id: string;
  readonly city: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
  readonly description: string;
  readonly photoUrl?: string;
  readonly status: CandidateState;
  readonly reason?: ResearchReason;
}

export interface GlobeOrigin {
  readonly city: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
}

export interface GlobeRoute {
  readonly city: string;
  readonly country: string;
  readonly description: string;
  readonly flag: string;
  readonly key: string;
  readonly label: string;
  readonly from: GeoCoordinate;
  readonly photoUrl?: string;
  readonly rejectionReason?: string;
  readonly officialUrl?: string;
  readonly status: CandidateState;
  readonly to: GeoCoordinate;
}

export type GlobeUnavailableReason =
  | "context-lost"
  | "dynamic-import"
  | "earth-material"
  | "model-load"
  | "react-render"
  | "renderer-init"
  | "webgl-unsupported";
