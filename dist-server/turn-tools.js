// multibot (A2): wyliczenie narzędzi, które tura faktycznie dostała — trafia do
// promptu systemowego każdego drivera CLI/API. Dziś bot dowiadywał się tylko, że
// MA komputer (akapit o komputerze), ale nie znał reszty oferty; a bot bez
// komputera nie dowiadywał się niczego. Tu prompt dostaje jeden spójny akapit:
// „tego dostałeś narzędzia, tego nie dostałeś i dlaczego".
//
// Listy są statyczne — mirror z dwóch miejsc, żeby nie importować spawnerów
// (agents-proxy.ts to skrypt z runem, nie moduł):
//   - AGENTS_MCP_TOOLS  = TOOLS w server/drivers/agents-proxy.ts (22 narzędzia)
//   - COMPUTER_MCP_TOOLS = @mcp.tool() w engine/server/computer_mcp.py (10)
// Staleness pilnuje test, który czyta oba źródła z dysku (tak samo, jak test
// pilnuje CURSOR_COLORS).
/** Narzędzia serwera MCP komputera — mirror `engine/server/computer_mcp.py`. */
export const COMPUTER_MCP_TOOLS = [
    "screenshot",
    "navigate",
    "read_page",
    "click",
    "move",
    "type_text",
    "key",
    "scroll",
    "status",
    "computer_exec",
];
/** Narzędzia serwera agents — mirror `server/drivers/agents-proxy.ts` TOOLS. */
export const AGENTS_MCP_TOOLS = [
    "list_bots",
    "ask_bot",
    "get_my_profile",
    "update_my_profile",
    "remember",
    "recall",
    "read_memory",
    "create_skill",
    "list_skills",
    "create_routine",
    "list_routines",
    "run_routine",
    "create_agent",
    "update_agent",
    "list_groups",
    "create_group",
    "delete_group",
    "send_group_message",
    "read_file",
    "write_file",
    "run_command",
    "get_device_info",
];
/**
 * Markdown z wyliczeniem narzędzi tej tury. Pusty string tylko wtedy, gdy
 * integrations jest puste — a wtedy nie dodajemy do promptu żadnego akapitu
 * (bot po prostu działa na swoich natywnych narzędziach, jak w stockowym
 * OpenMausBot).
 */
export function turnToolsText(integrations) {
    if (!integrations)
        return "";
    const lines = [];
    if (integrations.localComputer) {
        lines.push(`Computer MCP tools this turn (${COMPUTER_MCP_TOOLS.length}): ${COMPUTER_MCP_TOOLS.join(", ")}.`);
    }
    if (integrations.agents) {
        lines.push(`Agents/workspace MCP tools this turn (${AGENTS_MCP_TOOLS.length}): ${AGENTS_MCP_TOOLS.join(", ")}.`);
    }
    if (integrations.composio) {
        lines.push("Composio integration tools this turn: your connected apps (dynamic toolset).");
    }
    if (!lines.length) {
        lines.push("No MCP tools are mounted this turn — work with the tools you have, say plainly what you cannot do, and ask the user when only they can help.");
    }
    return lines.join("\n");
}
