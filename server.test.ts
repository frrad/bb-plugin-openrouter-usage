import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

test("usage resources are listed for every host", async () => {
  const hosts = [
    makeHostResponse({ id: "host_rhino", name: "rhino" }),
    makeHostResponse({ id: "host_mac", name: "Frederick’s MacBook Air" }),
  ];
  const { bb, harness } = createFakePluginHost({
    pluginId: "openrouter-usage",
    sdk: { hosts: { list: async () => hosts } },
  });

  try {
    await plugin(bb);
    const result = await harness.behavior.callRpc(
      "provider-usage.v1.listResources",
      {},
    );
    assert.deepEqual(
      result.resources.map((resource) => ({
        id: resource.id,
        hostId: resource.scope.hostId,
        hostName: resource.scope.hostName,
      })),
      [
        { id: "openrouter:host_rhino", hostId: "host_rhino", hostName: "rhino" },
        {
          id: "openrouter:host_mac",
          hostId: "host_mac",
          hostName: "Frederick’s MacBook Air",
        },
      ],
    );
    await assert.rejects(
      harness.behavior.callRpc("provider-usage.v1.getResource", {
        resourceId: "openrouter:host_removed",
        refresh: false,
      }),
      /Unknown usage resource/,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
