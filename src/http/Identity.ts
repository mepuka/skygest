import { ServiceMap } from "effect";
import type { AccessIdentity } from "../auth/AuthService";

export class OperatorIdentity extends ServiceMap.Service<
  OperatorIdentity,
  AccessIdentity
>()("@skygest/http/OperatorIdentity") {}

export const operatorIdentityContext = (identity: AccessIdentity) =>
  ServiceMap.add(ServiceMap.empty(), OperatorIdentity, identity);
