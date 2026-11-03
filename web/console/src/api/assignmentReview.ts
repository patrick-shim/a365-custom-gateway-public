import { api } from "./client";
import { ApiError } from "./errors";

function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Review cancelled", "AbortError");
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Review cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 5000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Reads start only from Review assignment. Cancelling the view stops polling,
// while an accepted connector operation continues durably on the server.
export async function refreshAssignmentCatalog(policyId: string, signal: AbortSignal) {
  const deadline = Date.now() + 7 * 60_000;
  const wait = async (operationId: string) => {
    while (Date.now() < deadline) {
      cancelled(signal);
      const operation = await api.getPurviewConnectorOperation(operationId);
      cancelled(signal);
      if (operation.status === "Succeeded") return operation;
      if (!["Pending", "Running"].includes(operation.status))
        throw new ApiError("Purview policy check did not complete. No assignment was submitted. Check the Purview connection, or explicitly review the saved policy.", 503);
      await pause(signal);
    }
    throw new ApiError("Policy check is taking longer than expected. No assignment was submitted. The accepted operation continues in the background; check Manual sync for its status.", 504);
  };
  const idleConnection = async () => {
    let connection = await api.getPurviewConnection();
    cancelled(signal);
    while (connection.currentOperationId && ["Connecting", "Refreshing"].includes(connection.state)) {
      await wait(connection.currentOperationId);
      connection = await api.getPurviewConnection();
      cancelled(signal);
      if (connection.currentOperationId && ["Connecting", "Refreshing"].includes(connection.state))
        await pause(signal);
    }
    return connection;
  };
  let connection = await idleConnection();
  let catalog = await api.listPurviewPolicies();
  cancelled(signal);
  const age = Date.now() - Date.parse(catalog.retrievedAtUtc);
  if (!Number.isFinite(age) || age < 0 || age >= 72 * 60 * 60_000) {
    const accepted = await api.refreshPurviewPolicies(connection.rowVersion);
    const completed = await wait(accepted.operationId);
    catalog = await api.listPurviewPolicies();
    cancelled(signal);
    if (!Number.isFinite(Date.parse(catalog.retrievedAtUtc)) ||
        Date.parse(catalog.retrievedAtUtc) < Date.parse(completed.startedAtUtc))
      throw new ApiError("The refreshed policy catalog is not available yet. Review again after sync completes.", 409);
    connection = await idleConnection();
  }
  if (!catalog.items.some(policy => policy.id === policyId))
    throw new ApiError("The selected policy is no longer in the catalog. Select another policy.", 409);
  const accepted = await api.refreshPurviewPolicies(connection.rowVersion, crypto.randomUUID(), policyId);
  await wait(accepted.operationId);
  catalog = await api.listPurviewPolicies();
  cancelled(signal);
  return catalog;
}
