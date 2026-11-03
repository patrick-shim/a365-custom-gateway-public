import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { ApiError } from "./errors";
import { evaluateAgentPrompt, TestRequestError, type TestStep } from "./simulator";
import { verifyProtection } from "./protectionVerification";
import type { AgentDetail } from "./types";

vi.mock("./client", () => ({
  api: {
    getAgent: vi.fn(),
    listAgentPolicies: vi.fn(),
    getPurviewConnection: vi.fn(),
    confirmAgentPolicy: vi.fn(),
  },
}));
vi.mock("./simulator", async (original) => ({
  ...(await original<typeof import("./simulator")>()),
  evaluateAgentPrompt: vi.fn(),
}));
const agent = {
  agentId: "agent",
  externalAgentId: "external",
  status: "Active",
  rowVersion: "one",
  agent365: { agentId: "child", blueprintId: "blueprint" },
  features: { promptShieldEffectivelyEnabled: true, purviewEnabled: true },
} as AgentDetail;
const assignments = {
  agentId: "agent",
  agentIdentityId: "child",
  bindingCurrent: true,
  allowObservedAtUtc: null,
  blockObservedAtUtc: null,
  items: [
    {
      operationId: "operation",
      policyId: "policy",
      policyName: "Policy",
      status: "Assigned" as const,
      failureCode: null,
      assignedAtUtc: "2026-11-03T00:00:00Z",
    },
  ],
};
const verdict = (decision: string, shield: string, purview: string) => ({
  evaluationId: "receipt",
  evaluationReceiptId: decision === "PROMPT_ALLOWED" ? "receipt" : null,
  interactionId: "interaction",
  allowed: decision === "PROMPT_ALLOWED",
  decision,
  promptShieldProcessing: shield,
  purviewProcessing: purview,
  userMessage: "",
  correlationId: "reference",
});
const makeInput = () => ({
  agentId: "agent",
  externalAgentId: "external",
  apiKey: "never-save-this-key",
  userObjectId: "user",
  dlpSample: "approved synthetic content",
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getAgent).mockResolvedValue(agent);
  vi.mocked(api.listAgentPolicies).mockResolvedValue(assignments);
  vi.mocked(api.getPurviewConnection).mockResolvedValue({
    connectorInstanceId: "connector",
    state: "Connected",
    lastHeartbeatAtUtc: new Date().toISOString(),
  } as Awaited<ReturnType<typeof api.getPurviewConnection>>);
  vi.mocked(evaluateAgentPrompt)
    .mockResolvedValueOnce(verdict("PROMPT_ALLOWED", "Allowed", "Allowed"))
    .mockResolvedValueOnce(verdict("PROMPT_BLOCKED_BY_PROMPT_SHIELD", "Blocked", "Allowed"))
    .mockResolvedValueOnce(verdict("PROMPT_BLOCKED_BY_DLP", "Allowed", "Blocked"));
});
afterEach(() => vi.useRealTimers());

it("passes only the expected isolated provider outcomes and clears the key", async () => {
  const input = makeInput();
  let steps: TestStep[] = [];
  const result = await verifyProtection(input, new AbortController().signal, (value) => {
    steps = value;
  });
  expect(result.outcome).toBe("Ready");
  expect(steps.every((step) => step.status === "Succeeded")).toBe(true);
  expect(evaluateAgentPrompt).toHaveBeenCalledTimes(3);
  expect(api.confirmAgentPolicy).not.toHaveBeenCalled();
  expect(api.getPurviewConnection).not.toHaveBeenCalled();
  expect(input.apiKey).toBe("");
  expect(JSON.stringify(steps)).not.toContain("never-save-this-key");
});
it.each([
  ["PROMPT_ALLOWED", "Allowed", "Allowed"],
  ["PROMPT_BLOCKED_BY_PROMPT_SHIELD", "Blocked", "Allowed"],
  ["PROMPT_BLOCKED_BY_MULTIPLE_CONTROLS", "Blocked", "Blocked"],
  ["PROMPT_BLOCKED_BY_DLP", "Skipped", "Blocked"],
])("does not verify DLP from an unexpected verdict %s / %s", async (decision, shield, purview) => {
  vi.mocked(evaluateAgentPrompt)
    .mockReset()
    .mockResolvedValueOnce(verdict("PROMPT_ALLOWED", "Allowed", "Allowed"))
    .mockResolvedValueOnce(verdict("PROMPT_BLOCKED_BY_PROMPT_SHIELD", "Blocked", "Allowed"))
    .mockResolvedValueOnce(verdict(decision, shield, purview));
  expect(
    (await verifyProtection(makeInput(), new AbortController().signal, () => {})).outcome,
  ).toBe("NeedsAttention");
});
it("stops after an unavailable provider without replay or later probes", async () => {
  vi.mocked(evaluateAgentPrompt)
    .mockReset()
    .mockRejectedValue(new TestRequestError("Unavailable", true));
  let steps: TestStep[] = [];
  expect(
    (
      await verifyProtection(makeInput(), new AbortController().signal, (value) => {
        steps = value;
      })
    ).outcome,
  ).toBe("NeedsAttention");
  expect(evaluateAgentPrompt).toHaveBeenCalledTimes(1);
  expect(steps.at(-1)?.status).toBe("Unconfirmed");
});
it("stops if settings change between probes", async () => {
  vi.mocked(api.getAgent)
    .mockResolvedValueOnce(agent)
    .mockResolvedValueOnce(agent)
    .mockResolvedValueOnce(agent)
    .mockResolvedValue({ ...agent, rowVersion: "changed" });
  expect(
    (await verifyProtection(makeInput(), new AbortController().signal, () => {})).outcome,
  ).toBe("NeedsAttention");
  expect(evaluateAgentPrompt).toHaveBeenCalledTimes(1);
});
it("does not submit an assignment while the connector heartbeat is stale", async () => {
  vi.mocked(api.getPurviewConnection).mockResolvedValue({
    connectorInstanceId: "connector",
    state: "Connected",
    lastHeartbeatAtUtc: "2000-01-01T00:00:00Z",
  } as Awaited<ReturnType<typeof api.getPurviewConnection>>);
  expect(
    (
      await verifyProtection(
        { ...makeInput(), assignmentOperationId: "operation" },
        new AbortController().signal,
        () => {},
      )
    ).outcome,
  ).toBe("NeedsAttention");
  expect(api.confirmAgentPolicy).not.toHaveBeenCalled();
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
});
it("submits exactly once, then waits for the same operation before checking protection", async () => {
  vi.useFakeTimers();
  vi.mocked(api.listAgentPolicies)
    .mockResolvedValueOnce({
      ...assignments,
      bindingCurrent: false,
      items: [{ ...assignments.items[0], status: "Pending" }],
    })
    .mockResolvedValue(assignments);
  const run = verifyProtection(
    { ...makeInput(), assignmentOperationId: "operation" },
    new AbortController().signal,
    () => {},
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect((await run).outcome).toBe("Ready");
  expect(api.confirmAgentPolicy).toHaveBeenCalledTimes(1);
  expect(api.confirmAgentPolicy).toHaveBeenCalledWith("agent", "operation");
});
it("does not replay an uncertain assignment or start probes", async () => {
  vi.mocked(api.confirmAgentPolicy).mockRejectedValue(
    new ApiError("secret dependency body", 503, "UNKNOWN", undefined, true),
  );
  let steps: TestStep[] = [];
  await verifyProtection(
    { ...makeInput(), assignmentOperationId: "operation" },
    new AbortController().signal,
    (value) => {
      steps = value;
    },
  );
  expect(api.confirmAgentPolicy).toHaveBeenCalledTimes(1);
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
  expect(JSON.stringify(steps)).not.toContain("secret dependency body");
  expect(steps.at(-1)?.status).toBe("Unconfirmed");
});
it("bounds pending assignment polling without submitting content", async () => {
  vi.useFakeTimers();
  vi.mocked(api.listAgentPolicies).mockResolvedValue({
    ...assignments,
    bindingCurrent: false,
    items: [{ ...assignments.items[0], status: "Pending" }],
  });
  const run = verifyProtection(makeInput(), new AbortController().signal, () => {});
  await vi.advanceTimersByTimeAsync(125_000);
  expect((await run).outcome).toBe("NeedsAttention");
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
  expect(api.confirmAgentPolicy).not.toHaveBeenCalled();
});
it("cancellation prevents all subsequent provider calls", async () => {
  const abort = new AbortController();
  abort.abort();
  const input = makeInput();
  expect((await verifyProtection(input, abort.signal, () => {})).outcome).toBe("Cancelled");
  expect(api.getAgent).not.toHaveBeenCalled();
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
  expect(input.apiKey).toBe("");
});
it("never reports ready for disabled controls", async () => {
  vi.mocked(api.getAgent).mockResolvedValue({
    ...agent,
    features: { ...agent.features!, promptShieldEffectivelyEnabled: false },
  });
  expect(
    (await verifyProtection(makeInput(), new AbortController().signal, () => {})).outcome,
  ).toBe("NeedsAttention");
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
});

it("discards the key immediately when cancelled during a pending read", async () => {
  let finishRead!: (value: AgentDetail) => void;
  vi.mocked(api.getAgent).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  const input = makeInput();
  const abort = new AbortController();
  const run = verifyProtection(input, abort.signal, () => {});
  abort.abort();
  expect(input.apiKey).toBe("");
  finishRead(agent);
  expect((await run).outcome).toBe("Cancelled");
  expect(evaluateAgentPrompt).not.toHaveBeenCalled();
});
