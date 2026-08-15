const active = new Map();
export function setTurnPolicy(threadId, policy) {
    active.set(threadId, {
        autonomy: policy.autonomy,
        access: policy.access,
        permissions: { ...policy.permissions },
        approvalRules: policy.approvalRules?.map((rule) => ({ ...rule })) ?? [],
    });
}
export function clearTurnPolicy(threadId) {
    active.delete(threadId);
}
export function turnPolicy(threadId) {
    const policy = active.get(threadId);
    return policy ? {
        autonomy: policy.autonomy,
        access: policy.access,
        permissions: { ...policy.permissions },
        approvalRules: policy.approvalRules?.map((rule) => ({ ...rule })) ?? [],
    } : undefined;
}
export function approvalRuleAllowed(threadId, rule) {
    return active.get(threadId)?.approvalRules?.some((saved) => saved.provider === rule.provider && saved.key === rule.key) ?? false;
}
export function rememberApprovalRule(threadId, rule) {
    const policy = active.get(threadId);
    if (!policy)
        return;
    const rules = (policy.approvalRules ??= []);
    if (!rules.some((saved) => saved.provider === rule.provider && saved.key === rule.key))
        rules.push({ ...rule });
}
export function toolsetFor(tool) {
    const name = tool.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (/(?:ask_bot|list_bots|agent|delegat|peer)/.test(name))
        return "delegation";
    if (/(?:browser|computer|navigate|screenshot|webfetch|websearch|open_url)/.test(name))
        return "browser";
    if (/(?:memory|remember|recall)/.test(name))
        return "memory";
    if (/(?:skill)/.test(name))
        return "skills";
    if (/(?:bash|shell|terminal|command|execute|process|computer_exec)/.test(name))
        return "terminal";
    if (/(?:edit|write|read|file|glob|grep|notebook|patch)/.test(name))
        return "file";
    return "integrations";
}
export function toolAllowed(threadId, tool) {
    const policy = active.get(threadId);
    if (!policy)
        return true;
    if (policy.access === "read-only" && ["browser", "delegation", "file", "integrations", "terminal"].includes(toolsetFor(tool)))
        return false;
    return policy.permissions[toolsetFor(tool)] !== false;
}
export function autoApproveAllowed(threadId, tool) {
    const policy = active.get(threadId);
    return (policy?.access === "full" || policy?.autonomy === "autonomous") && toolAllowed(threadId, tool);
}
export function canUseIntegration(threadId, kind) {
    const policy = active.get(threadId);
    return !policy || policy.permissions[kind] !== false;
}
