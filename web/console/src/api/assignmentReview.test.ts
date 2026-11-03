import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { refreshAssignmentCatalog } from "./assignmentReview";

vi.mock("./client", () => ({ api: {
  getPurviewConnection: vi.fn(), refreshPurviewPolicies: vi.fn(),
  getPurviewConnectorOperation: vi.fn(), listPurviewPolicies: vi.fn(),
} }));
const mock = vi.mocked(api);
const startedAtUtc = "2026-11-03T00:00:00Z";
beforeEach(() => {
  vi.resetAllMocks();
  mock.getPurviewConnection.mockResolvedValue({ state: "Connected", rowVersion: "row" } as never);
  mock.refreshPurviewPolicies.mockResolvedValue({ operationId: "refresh" } as never);
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Succeeded", startedAtUtc } as never);
  mock.listPurviewPolicies.mockResolvedValue({ retrievedAtUtc: startedAtUtc, items: [{ id: "policy", revision: "new" }] } as never);
});
afterEach(() => vi.useRealTimers());

it("returns the new catalog after acceptance rather than the revision before another agent was assigned", async () => {
  const result = await refreshAssignmentCatalog(new AbortController().signal);
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledWith("row");
  expect(result.items[0].revision).toBe("new");
  expect(mock.getPurviewConnectorOperation.mock.invocationCallOrder[0]).toBeLessThan(mock.listPurviewPolicies.mock.invocationCallOrder[0]);
});

it("joins an active refresh and polls without submitting another read", async () => {
  vi.useFakeTimers();
  mock.getPurviewConnection.mockResolvedValue({ state: "Refreshing", currentOperationId: "existing" } as never);
  mock.getPurviewConnectorOperation.mockResolvedValueOnce({ status: "Running" } as never);
  const task = refreshAssignmentCatalog(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000);
  await task;
  expect(mock.refreshPurviewPolicies).not.toHaveBeenCalled();
  expect(mock.getPurviewConnectorOperation).toHaveBeenCalledWith("existing");
});

it.each(["Failed", "NeedsAttention", "TimedOut", "Cancelled"])("does not fall back to saved revisions after %s", async status => {
  mock.getPurviewConnectorOperation.mockResolvedValue({ status } as never);
  await expect(refreshAssignmentCatalog(new AbortController().signal)).rejects.toThrow("No assignment was submitted");
  expect(mock.listPurviewPolicies).not.toHaveBeenCalled();
});

it("rejects a saved snapshot older than the completed refresh", async () => {
  mock.listPurviewPolicies.mockResolvedValue({ retrievedAtUtc: "2026-11-02T00:00:00Z" } as never);
  await expect(refreshAssignmentCatalog(new AbortController().signal)).rejects.toThrow("not available yet");
});

it("stops polling on navigation without starting another operation", async () => {
  vi.useFakeTimers();
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Running" } as never);
  const controller = new AbortController();
  const task = refreshAssignmentCatalog(controller.signal);
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.getPurviewConnectorOperation).toHaveBeenCalledTimes(1);
  expect(mock.listPurviewPolicies).not.toHaveBeenCalled();
});

it("stops waiting at a bounded deadline without retrying the accepted operation", async () => {
  vi.useFakeTimers();
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Running" } as never);
  const task = refreshAssignmentCatalog(new AbortController().signal);
  const rejected = expect(task).rejects.toThrow("continues in the background");
  await vi.advanceTimersByTimeAsync(7 * 60000);
  await rejected;
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
});
