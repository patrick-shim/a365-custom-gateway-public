import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
import { ProtectionVerificationPanel } from "./ProtectionVerificationPanel";
import { verifyProtection } from "../../api/protectionVerification";
import type { AgentDetail } from "../../api/types";

vi.mock("../../auth/msal", () => ({
  getAccount: () => ({ idTokenClaims: { oid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }),
}));
vi.mock("../../api/protectionVerification", () => ({
  normalProbe: "Normal probe",
  shieldProbe: "Synthetic injection probe",
  verifyProtection: vi.fn(),
}));
const agent = {
  agentId: "agent",
  name: "Support",
  externalAgentId: "support",
  status: "Active",
} as AgentDetail;
beforeEach(() => vi.resetAllMocks());
function mount() {
  const close = vi.fn();
  const finished = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ProtectionVerificationPanel agent={agent} onClose={close} onFinished={finished} />
      </MemoryRouter>
    </FluentProvider>,
  );
  return { close, finished };
}
async function enterInput() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Registered API key"), "temporary-key");
  await user.type(
    screen.getByLabelText("Approved synthetic DLP sample"),
    "approved synthetic sample",
  );
  expect(screen.getByRole("button", { name: "Run protection checks" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  return user;
}
it("requires approved synthetic content and clears credentials before verification", async () => {
  const { finished } = mount();
  let complete!: (value: { outcome: "Ready"; completedAt: string }) => void;
  vi.mocked(verifyProtection).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const user = await enterInput();
  await user.click(screen.getByRole("button", { name: "Run protection checks" }));
  expect(screen.getByLabelText("Registered API key")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Verifying protection…" })).toBeDisabled();
  expect(verifyProtection).toHaveBeenCalledWith(
    expect.objectContaining({
      externalAgentId: "support",
      apiKey: "temporary-key",
      dlpSample: "approved synthetic sample",
    }),
    expect.any(AbortSignal),
    expect.any(Function),
  );
  complete({ outcome: "Ready", completedAt: new Date().toISOString() });
  expect(await screen.findByText("Ready for beta use")).toBeVisible();
  expect(finished).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("temporary-key")).toBeNull();
});
it("closing cancels the active run and never starts another submission", async () => {
  const { close } = mount();
  vi.mocked(verifyProtection).mockImplementation(
    (_input, signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () =>
          resolve({ outcome: "Cancelled", completedAt: new Date().toISOString() }),
        ),
      ),
  );
  const user = await enterInput();
  await user.click(screen.getByRole("button", { name: "Run protection checks" }));
  const signal = vi.mocked(verifyProtection).mock.calls[0][1];
  await user.click(screen.getByRole("button", { name: "Close protection verification" }));
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(verifyProtection).toHaveBeenCalledTimes(1));
});
