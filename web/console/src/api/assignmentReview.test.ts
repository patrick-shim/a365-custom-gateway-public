import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { refreshAssignmentCatalog } from "./assignmentReview";

vi.mock("./client", () => ({ api: {
  getPurviewConnection: vi.fn(), refreshPurviewPolicies: vi.fn(),
  getPurviewConnectorOperation: vi.fn(), listPurviewPolicies: vi.fn(),
} }));
const mock = vi.mocked(api);
const now = new Date("2026-11-03T12:00:00Z");
const catalog = (ageHours = 1) => ({ retrievedAtUtc: new Date(+now - ageHours * 3600000).toISOString(), items: [{ id: "policy", revision: "new" }] });
const run = () => refreshAssignmentCatalog("policy", new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mock.getPurviewConnection.mockResolvedValue({ state: "Connected", rowVersion: "row" } as never);
  mock.refreshPurviewPolicies.mockResolvedValue({ operationId: "refresh" } as never);
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Succeeded", startedAtUtc: now.toISOString() } as never);
  mock.listPurviewPolicies.mockResolvedValue(catalog() as never);
});
afterEach(() => vi.useRealTimers());

it.each([0, 1, 71.999])("reuses a %s-hour catalog while checking only the exact selected policy", async age => {
  mock.listPurviewPolicies.mockResolvedValue(catalog(age) as never);
  const result = await run();
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledWith("row", expect.any(String), "policy");
  expect(result.retrievedAtUtc).toBe(catalog(age).retrievedAtUtc);
});
it.each([72, 100, -1])("refreshes the full %s-hour catalog before checking the selected policy", async age => {
  mock.listPurviewPolicies.mockResolvedValueOnce(catalog(age) as never).mockResolvedValue(catalog(0) as never);
  await run();
  expect(mock.refreshPurviewPolicies.mock.calls.map(args => args[2])).toEqual([undefined, "policy"]);
});
it("rejects a snapshot that did not advance after an expired-catalog refresh", async () => {
  mock.listPurviewPolicies.mockResolvedValue(catalog(73) as never);
  await expect(run()).rejects.toThrow("not available yet");
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
});
it("waits for existing connector work, then submits its own exact policy check", async () => {
  mock.getPurviewConnection.mockResolvedValueOnce({ state: "Refreshing", currentOperationId: "existing" } as never);
  mock.getPurviewConnectorOperation.mockResolvedValueOnce({ status: "Running" } as never);
  const task = run();
  await vi.advanceTimersByTimeAsync(5000);
  await task;
  expect(mock.getPurviewConnectorOperation).toHaveBeenCalledWith("existing");
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledWith("row", expect.any(String), "policy");
});
it.each(["Failed", "NeedsAttention", "TimedOut", "Cancelled"])("does not silently fall back after %s", async status => {
  mock.getPurviewConnectorOperation.mockResolvedValue({ status } as never);
  await expect(run()).rejects.toThrow("No assignment was submitted");
  expect(mock.listPurviewPolicies).toHaveBeenCalledTimes(1);
});
it("rejects a selection removed by full refresh", async () => {
  mock.listPurviewPolicies.mockResolvedValueOnce(catalog(73) as never).mockResolvedValue({ ...catalog(0), items: [] } as never);
  await expect(run()).rejects.toThrow("no longer in the catalog");
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
});
it("stops polling on navigation without starting another operation", async () => {
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Running" } as never);
  const controller = new AbortController();
  const task = refreshAssignmentCatalog("policy", controller.signal);
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.getPurviewConnectorOperation).toHaveBeenCalledTimes(1);
});
it("bounds waiting without retrying an accepted operation", async () => {
  mock.getPurviewConnectorOperation.mockResolvedValue({ status: "Running" } as never);
  const task = run();
  const rejected = expect(task).rejects.toThrow("continues in the background");
  await vi.advanceTimersByTimeAsync(7 * 60000);
  await rejected;
  expect(mock.refreshPurviewPolicies).toHaveBeenCalledTimes(1);
});
