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

// Refresh only in response to Review assignment. Polling never submits another
// operation, and cancelling the view cannot cancel an already accepted read.
export async function refreshAssignmentCatalog(signal: AbortSignal) {
  const deadline = Date.now() + 7 * 60_000;
  const connection = await api.getPurviewConnection();
  cancelled(signal);
  let operationId = ["Connecting", "Refreshing"].includes(connection.state)
    ? connection.currentOperationId
    : null;
  if (!operationId) {
    const accepted = await api.refreshPurviewPolicies(connection.rowVersion);
    operationId = accepted.operationId;
  }
  while (Date.now() < deadline) {
    cancelled(signal);
    const operation = await api.getPurviewConnectorOperation(operationId);
    cancelled(signal);
    if (operation.status === "Succeeded") {
      const catalog = await api.listPurviewPolicies();
      cancelled(signal);
      if (Date.parse(catalog.retrievedAtUtc) < Date.parse(operation.startedAtUtc))
        throw new ApiError("The refreshed policy catalog is not available yet. Review again after sync completes.", 409);
      return catalog;
    }
    if (!["Pending", "Running"].includes(operation.status))
      throw new ApiError("Purview policy refresh did not complete. No assignment was submitted. Check the Purview connection, or explicitly review the saved policy.", 503);
    await pause(signal);
  }
  throw new ApiError("Policy refresh is taking longer than expected. No assignment was submitted. The accepted refresh continues in the background; check Manual sync for its status.", 504);
}
