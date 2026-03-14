import { Context } from "effect";
import type { AccessIdentity } from "../auth/AuthService";

export class OperatorIdentity extends Context.Tag("@skygest/http/OperatorIdentity")<
  OperatorIdentity,
  AccessIdentity
>() {}

export const operatorIdentityContext = (identity: AccessIdentity) =>
  Context.add(Context.empty(), OperatorIdentity, identity);
