namespace Gateway.Domain.Models;

/// <summary>
/// Names the Agent 365 identity a prompt evaluation belongs to.
/// Prompt Shields is a per-agent control rather than a blueprint-level one, so a
/// verdict has to be attributable to the individual agent that made the call and
/// not merely to the blueprint it shares with its siblings.
/// <para>
/// <see cref="Agent365AgentId"/> and <see cref="BlueprintId"/> are nullable on
/// purpose. An agent whose Agent 365 provisioning has not completed still gets a
/// real verdict. Keep an absent identity explicit so the recorded evidence does
/// not imply that provisioning has completed.
/// </para>
/// </summary>
public sealed record PromptShieldSubject(
    Guid AgentRegistrationId,
    Guid? Agent365AgentId,
    Guid? BlueprintId,
    string CorrelationId);
