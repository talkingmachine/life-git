import { initialPlaceFrontierEventState } from
  "../../../src/experience/place-frontier-stream";
import {
  createPlaceFrontierRunningState,
  projectPlaceFrontierView,
} from "../../../src/experience/place-frontier-view-model";
import {
  initialCountryResolutionEventState,
} from "../../../src/experience/country-resolution-stream";
import {
  presentCountryResolutionReadModel,
  projectCountryResolutionView,
} from "../../../src/experience/country-resolution-view-model";
import {
  initialCityFrontierEventState,
} from "../../../src/experience/city-frontier-stream";
import {
  presentCityFrontierReadModel,
  projectCityFrontierView,
} from "../../../src/experience/city-frontier-view-model";

export function smokePlaceFrontierClientBundle() {
  return {
    eventState: initialPlaceFrontierEventState(),
    view: projectPlaceFrontierView(createPlaceFrontierRunningState("bundle-smoke-run")),
  };
}

export function smokeCountryResolutionClientBundle(readModel: Parameters<
  typeof presentCountryResolutionReadModel
>[0]) {
  return {
    eventState: initialCountryResolutionEventState(readModel),
    view: projectCountryResolutionView(presentCountryResolutionReadModel(readModel)),
  };
}

export function smokeCityFrontierClientBundle(readModel: Parameters<
  typeof presentCityFrontierReadModel
>[0]) {
  return {
    eventState: initialCityFrontierEventState(readModel),
    view: projectCityFrontierView(presentCityFrontierReadModel(readModel)),
  };
}
