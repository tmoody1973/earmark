import { defineChannel, POST } from "eve/channels";
import { getEnv } from "../lib/env";
import { handleRelayRequest } from "../lib/bee/webhook";
import { handleBeeEvent } from "../lib/pipeline/ingest";

export default defineChannel({
  routes: [
    POST("/api/bee/events", (request, { waitUntil }) =>
      handleRelayRequest(request, {
        secret: getEnv().EARMARK_WEBHOOK_SECRET,
        waitUntil,
        handle: (evt) => handleBeeEvent(evt),
      }),
    ),
  ],
});
