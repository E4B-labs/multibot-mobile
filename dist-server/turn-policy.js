const active = new Map();
export function setTurnPolicy(threadId, policy) {
    active.set(threadId, { autonomy: policy.autonomy, permissions: { ...policy.permissions } });
}
export function clearTurnPolicy(threadId) {
    active.delete(threadId);
}
export function turnPolicy(threadId) {
    const policy = active.get(threadId);
    return policy ? { autonomy: policy.autonomy, permissions: { ...policy.permissions } } : undefined;
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
    return policy.permissions[toolsetFor(tool)] !== false;
}
export function autoApproveAllowed(threadId, tool) {
    const policy = active.get(threadId);
    return policy?.autonomy === "autonomous" && toolAllowed(threadId, tool);
}
export function canUseIntegration(threadId, kind) {
    const policy = active.get(threadId);
    return !policy || policy.permissions[kind] !== false;
}
