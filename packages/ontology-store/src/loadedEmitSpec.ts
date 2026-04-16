import { Schema } from "effect";

import emitSpecJson from "../generated/emit-spec.json";
import { EmitSpec } from "./Domain/EmitSpec";

export const loadedEmitSpec = Schema.decodeUnknownSync(EmitSpec)(emitSpecJson);
