export class ProviderRegistry {
    byId = new Map();
    driversByKind;
    constructor(drivers) {
        this.driversByKind = new Map(drivers.map((d) => [d.driverKind, d]));
    }
    async load(configs) {
        for (const [instanceId, entry] of Object.entries(configs)) {
            const driver = this.driversByKind.get(entry.driver);
            if (!driver) {
                this.byId.set(instanceId, {
                    instanceId,
                    shadow: {
                        instanceId,
                        driverKind: entry.driver,
                        displayName: entry.displayName,
                        enabled: entry.enabled ?? true,
                        shadow: true,
                        reason: `unknown driver "${entry.driver}" — kept as configured, unavailable here`,
                    },
                });
                continue;
            }
            // multibot (G1): `enabled` is the persistent CLI allow switch. Disabled
            // tools must not be spawned or remain routable through registry.get().
            if (entry.enabled === false) {
                this.byId.set(instanceId, {
                    instanceId,
                    shadow: {
                        instanceId,
                        driverKind: entry.driver,
                        displayName: entry.displayName ?? driver.metadata.displayName,
                        enabled: false,
                        shadow: true,
                        reason: "disabled in settings",
                    },
                });
                continue;
            }
            try {
                const config = entry.config === undefined ? driver.defaultConfig() : driver.decodeConfig(entry.config);
                const live = await driver.create({
                    instanceId,
                    displayName: entry.displayName ?? driver.metadata.displayName,
                    environment: entry.environment ?? {},
                    enabled: entry.enabled ?? true,
                    config,
                });
                this.byId.set(instanceId, { instanceId, live });
            }
            catch (e) {
                this.byId.set(instanceId, {
                    instanceId,
                    shadow: {
                        instanceId,
                        driverKind: entry.driver,
                        displayName: entry.displayName ?? driver.metadata.displayName,
                        enabled: entry.enabled ?? true,
                        shadow: true,
                        reason: e instanceof Error ? e.message : String(e),
                    },
                });
            }
        }
    }
    get(instanceId) {
        return this.byId.get(instanceId)?.live ?? null;
    }
    entries() {
        return [...this.byId.values()];
    }
    instances() {
        return [...this.byId.values()].flatMap((e) => (e.live ? [e.live] : []));
    }
    /** instance snapshots for the model picker: id, driver, models, health */
    async describe() {
        return Promise.all(this.entries().map(async (entry) => {
            if (entry.shadow) {
                return {
                    instanceId: entry.instanceId,
                    driverKind: entry.shadow.driverKind,
                    displayName: entry.shadow.displayName ?? entry.shadow.driverKind,
                    enabled: entry.shadow.enabled,
                    snapshot: { state: "unavailable", reason: entry.shadow.reason },
                    models: { default: "", options: [] },
                };
            }
            const inst = entry.live;
            let snapshot;
            try {
                snapshot = await inst.snapshot();
            }
            catch (e) {
                snapshot = { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
            }
            return {
                instanceId: inst.instanceId,
                driverKind: inst.driverKind,
                displayName: inst.displayName ?? inst.driverKind,
                enabled: inst.enabled,
                snapshot,
                models: inst.models,
            };
        }));
    }
    async disposeAll() {
        await Promise.allSettled(this.instances().map((i) => i.dispose()));
        this.byId.clear();
    }
}
