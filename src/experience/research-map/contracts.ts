export type CandidateState = "pending" | "green" | "yellow" | "red";
export type PlaceKind = "country" | "city";

export interface GeoCoordinate {
  readonly lat: number;
  readonly lng: number;
}

export interface ResearchReason {
  readonly summary: string;
  readonly officialUrl?: string;
  readonly officialUrls?: readonly string[];
  readonly manualCheckLinks?: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}

export interface ResearchCandidate {
  readonly id: string;
  readonly label: string;
  readonly kind: PlaceKind;
  readonly city?: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
  readonly description: string;
  readonly photoUrl?: string;
  readonly status: CandidateState;
  readonly statusLabel?: string;
  readonly reason?: ResearchReason;
}

export interface GlobeOrigin {
  readonly label: string;
  readonly kind: PlaceKind;
  readonly city?: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
}

export interface GlobeRoute {
  readonly label: string;
  readonly kind: PlaceKind;
  readonly city?: string;
  readonly country: string;
  readonly description: string;
  readonly flag: string;
  readonly key: string;
  readonly routeLabel: string;
  readonly from: GeoCoordinate;
  readonly photoUrl?: string;
  readonly rejectionReason?: string;
  readonly officialUrl?: string;
  readonly officialUrls?: readonly string[];
  readonly manualCheckLinks?: readonly {
    readonly label: string;
    readonly url: string;
  }[];
  readonly markerVisible?: boolean;
  readonly status: CandidateState;
  readonly statusLabel?: string;
  readonly to: GeoCoordinate;
}

export interface GlobeOverview {
  readonly key: number;
  readonly coordinates: readonly GeoCoordinate[];
}

export interface WorkspaceGlobePresentation {
  readonly activeFlight?: GlobeRoute;
  readonly ariaLabel: string;
  readonly backgroundColor?: string;
  readonly origin: GlobeOrigin;
  readonly overview: GlobeOverview;
  readonly routes: readonly GlobeRoute[];
}

export interface ResearchProgressItem {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly sourceUrl?: string;
  readonly current: boolean;
}

export type GlobeUnavailableReason =
  | "context-lost"
  | "dynamic-import"
  | "earth-material"
  | "model-load"
  | "react-render"
  | "renderer-init"
  | "webgl-unsupported";
