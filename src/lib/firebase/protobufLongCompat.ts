import "server-only";

import { util } from "protobufjs/minimal";

/**
 * `@google-cloud/firestore`'s REST fallback transport (used here via `preferRest: true` —
 * see `admin.ts`) serializes requests with `proto3-json-serializer`, which identifies 64-bit
 * integer values by checking `value.constructor.name === "Long"`. Next.js's production
 * minifier renames classes in the server bundle, so that check fails and every write of an
 * integer field (e.g. a board column's `position`) throws `toProto3JSON: don't know how to
 * convert value <n>`.
 *
 * Clearing `util.Long` makes protobufjs represent 64-bit integer fields as plain JS numbers
 * instead of `Long` instances, which `toProto3JSON` already serializes safely without any
 * constructor check. This is only safe because this app never writes a Firestore integer
 * field outside the JS safe-integer range.
 *
 * Must be imported before any `@google-cloud/firestore` / `google-gax` module: protobufjs
 * decides per-field whether to treat a type as a Long when it parses proto descriptors, which
 * those modules do as soon as they're loaded.
 */
util.Long = undefined as unknown as typeof util.Long;
