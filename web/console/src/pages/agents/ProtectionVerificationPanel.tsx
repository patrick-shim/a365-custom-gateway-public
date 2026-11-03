import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  Checkbox,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  OverlayDrawer,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { getAccount } from "../../auth/msal";
import {
  normalProbe,
  shieldProbe,
  verifyProtection,
  type VerificationResult,
} from "../../api/protectionVerification";
import type { AgentDetail } from "../../api/types";
import type { TestStep } from "../../api/simulator";
import { StatusPill } from "../../components/StatusPill";

type Props = {
  agent: AgentDetail;
  review?: { operationId: string; policyName: string; effect: string; expiresAtUtc: string };
  onClose: () => void;
  onFinished: () => void;
  onTest?: () => void;
};

export function ProtectionVerificationPanel({ agent, review, onClose, onFinished, onTest }: Props) {
  const [key, setKey] = useState("");
  const [user, setUser] = useState(String(getAccount()?.idTokenClaims?.oid ?? ""));
  const [sample, setSample] = useState("");
  const [approved, setApproved] = useState(false);
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [result, setResult] = useState<VerificationResult>();
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const close = () => {
    controller.current?.abort();
    setKey("");
    setSample("");
    onClose();
  };
  async function run() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 7 * 60_000);
    const input = {
      agentId: agent.agentId,
      externalAgentId: agent.externalAgentId,
      apiKey: key.trim(),
      userObjectId: user.trim(),
      dlpSample: sample,
      assignmentOperationId: review?.operationId,
    };
    setKey("");
    setBusy(true);
    setResult(undefined);
    setSteps([]);
    try {
      const completed = await verifyProtection(input, abort.signal, (next) => {
        if (mounted.current) setSteps(next);
      });
      if (mounted.current) setResult(completed);
    } finally {
      input.apiKey = "";
      clearTimeout(timer);
      controller.current = undefined;
      if (mounted.current) setBusy(false);
      onFinished();
    }
  }
  const validUser =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.trim()) &&
    !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(user.trim());
  const expired = review && Date.parse(review.expiresAtUtc) <= Date.now();
  return (
    <OverlayDrawer
      open
      position="end"
      size="medium"
      onOpenChange={(_, data) => {
        if (!data.open) close();
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button onClick={close} aria-label="Close protection verification">
              Close
            </Button>
          }
        >
          {review ? "Apply and verify" : "Run protection checks"} · Beta
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody style={{ display: "grid", gap: 16, alignContent: "start", paddingBottom: 24 }}>
        <Text size={500} weight="semibold">
          {agent.name}
        </Text>
        <Text>Individual agent: {agent.externalAgentId}</Text>
        {review && (
          <Card>
            <Text weight="semibold">{review.policyName}</Text>
            <Text>{review.effect}</Text>
          </Card>
        )}
        <Text>
          Checks assignment, normal allow, Prompt Shields block and DLP block using real protection
          APIs. No language model is called. A successful check is an observation at that time, not
          a guarantee of future availability.
        </Text>
        <Field
          label="Registered API key"
          hint="Used only in memory for this run; cleared from the form on submit and discarded on close."
        >
          <Input
            type="password"
            autoComplete="off"
            value={key}
            disabled={busy}
            onChange={(_, data) => setKey(data.value)}
          />
        </Field>
        <Field
          label="Test-user object ID"
          hint="Defaults to your signed-in Entra user. Purview evaluates this user's policy scope."
        >
          <Input value={user} disabled={busy} onChange={(_, data) => setUser(data.value)} />
        </Field>
        <Field
          label="Approved synthetic DLP sample"
          hint="Use synthetic content that matches your policy's classifiers and thresholds. Never paste real sensitive data."
        >
          <Textarea
            rows={4}
            maxLength={8000}
            value={sample}
            disabled={busy}
            onChange={(_, data) => setSample(data.value)}
          />
        </Field>
        <details>
          <summary>Review the other synthetic probes</summary>
          <p>Normal: {normalProbe}</p>
          <p>Prompt Shields: {shieldProbe}</p>
        </details>
        <Checkbox
          checked={approved}
          disabled={busy}
          onChange={(_, data) => setApproved(data.checked === true)}
          label="I approve these synthetic probes for the configured Microsoft protection services. They may be recorded by those services."
        />
        <Button
          appearance="primary"
          disabled={
            busy ||
            !!result ||
            !!expired ||
            agent.status !== "Active" ||
            !key.trim() ||
            !validUser ||
            !sample.trim() ||
            !approved
          }
          onClick={() => void run()}
        >
          {busy ? "Verifying protection…" : review ? "Apply and verify" : "Run protection checks"}
        </Button>
        {expired && !busy && !result && (
          <Text role="alert">
            This review expired. Close this panel and review the assignment again.
          </Text>
        )}
        <Text size={200}>
          Assignment checks stop after two minutes; the complete run stops after seven minutes.
          Closing stops remaining verification. An accepted assignment continues on the server.
          Content submissions are never automatically retried.
        </Text>
        <div aria-live="polite" aria-busy={busy} style={{ display: "grid", gap: 12 }}>
          {busy && <Spinner size="small" label="Checking protection" />}
          {result && (
            <Card>
              <Text size={500} weight="semibold">
                {result.outcome === "Ready"
                  ? "Ready for beta use"
                  : result.outcome === "Cancelled"
                    ? "Verification stopped"
                    : "Verification needs attention"}
              </Text>
              <Text>
                Checked {new Date(result.completedAt).toLocaleString()}. Review each result below.
              </Text>
              {result.outcome === "Ready" && onTest && (
                <Button
                  onClick={() => {
                    close();
                    onTest();
                  }}
                >
                  Open Test Agent
                </Button>
              )}
              {result.outcome !== "Ready" && (
                <Text>
                  Close this panel, follow the failed step's recovery instructions, and choose
                  Run protection checks for a new run.
                </Text>
              )}
            </Card>
          )}
          {steps.map((step) => (
            <Card key={step.name}>
              <Text weight="semibold">{step.name}</Text>
              <StatusPill value={step.status} />
              <Text>{step.detail}</Text>
              {step.reference && (
                <details>
                  <summary>Reference</summary>
                  <Text size={200}>{step.reference}</Text>
                </details>
              )}
            </Card>
          ))}
        </div>
        <Link to="/settings/purview" onClick={close}>
          Purview connection diagnostics
        </Link>
      </DrawerBody>
    </OverlayDrawer>
  );
}
