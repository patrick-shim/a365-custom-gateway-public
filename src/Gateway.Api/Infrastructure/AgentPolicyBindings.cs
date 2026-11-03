using Gateway.Domain.Entities;
using Gateway.Domain.Interfaces;
using Gateway.Domain.Models;
using Gateway.Infrastructure.Persistence;
using Gateway.Purview;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Gateway.Api.Infrastructure;

public sealed class AgentPolicyBindings(GatewayDbContext db,
    IOptions<RuntimePurviewCatalogOptions> options) : IAgentPolicyBindingReader
{
    public async Task<AgentPolicyBinding?> ReadAsync(AgentRegistration agent, CancellationToken ct)
    {
        if (agent.PurviewPolicySelectionMode != "ExistingPolicy" || !agent.FeatureConfiguration.PurviewEnabled ||
            !Guid.TryParse(agent.Agent365AgentId, out var child) || !Guid.TryParse(agent.BlueprintId, out var blueprint) || child == blueprint)
            return null;
        var rows = await db.AgentPolicyAssignments.AsNoTracking().Where(x => x.AgentRegistrationId == agent.Id && x.ConfirmedAtUtc != null).ToListAsync(ct);
        var selected = rows.GroupBy(x => x.PolicyId).Select(g => g.OrderByDescending(x => x.ConfirmedAtUtc).First()).OrderBy(x => x.PolicyId).ToArray();
        if (selected.Length == 0 || selected.Any(x => x.TenantId != options.Value.TenantId || x.Status != "Assigned" ||
            x.AgentIdentityId != child || x.BlueprintId != blueprint || x.AssignedAtUtc is null))
            return null;
        foreach (var row in selected)
        {
            if (string.IsNullOrWhiteSpace(row.AssignedRevision) || row.AssignedRevision.Length != 64 ||
                !row.AssignedRevision.All(char.IsAsciiHexDigitLower))
                return null;
        }

        // Runtime Graph scope computation and processContent provide current
        // fail-closed enforcement. The management catalog is operator inventory,
        // so its age must not silently disable an otherwise confirmed assignment.
        return new(PolicyAssignmentProtocol.Digest(selected.Select(x => new
        {
            x.Id,
            x.PolicyId,
            x.AssignedRevision,
            x.AgentIdentityId,
            x.BlueprintId,
            x.AssignedAtUtc
        })));
    }
}
