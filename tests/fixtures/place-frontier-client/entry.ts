import { initialPlaceFrontierEventState } from
  "../../../src/experience/place-frontier-stream";
import {
  createPlaceFrontierRunningState,
  projectPlaceFrontierView,
} from "../../../src/experience/place-frontier-view-model";

export function smokePlaceFrontierClientBundle() {
  return {
    eventState: initialPlaceFrontierEventState(),
    view: projectPlaceFrontierView(createPlaceFrontierRunningState("bundle-smoke-run")),
  };
}
