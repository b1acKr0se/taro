/**
 * The full-page project setup (decisions 13, 14): prerequisite checks, project,
 * agents, delivery, standing orders. The same page edits an existing project.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import {
  checkPrerequisites,
  launchManager,
  listModels,
  onboardProject,
  readStandingOrders,
  restartManager,
  writeProjectSettings,
  writeStandingOrders,
} from "../shared/contracts";
import { modelOptions as modelPickerOptions, thinkingAfterModelChange, thinkingOptions, toggleSubagentModel } from "../shared/model-picker";
import type { ProjectConfig, ProjectSettings } from "../shared/project";
import { ToggleChips } from "./ui";
import { FONT_SIZE } from "./type-scale";
import { errorText } from "./format";

interface Draft {
  project: string;
  repoPath: string;
  baseBranch: string;
  ticketPrefix: string;
  managerModel: string;
  managerThinking: string;
  ownerModel: string;
  ownerThinking: string;
  subagentModels: string[];
  delivery: "pull-request" | "local-only";
  acceptAlsoMerges: boolean;
  trackerSync: "local" | "remote";
  compactThresholdTokens: string;
  idleCompactThresholdTokens: string;
  maxParallelOwners: string;
}

/** A new project's model fields start empty and take the default once the model list arrives. */
function draftFrom(config: ProjectConfig | null): Draft {
  return {
    project: config?.project ?? "",
    repoPath: config?.repoPath ?? "",
    baseBranch: config?.baseBranch ?? "main",
    ticketPrefix: config?.ticketPrefix ?? "",
    managerModel: config?.manager.model ?? "",
    managerThinking: config?.manager.thinking ?? "",
    ownerModel: config?.owner.model ?? "",
    ownerThinking: config?.owner.thinking ?? "",
    subagentModels: config?.subagentModels ?? [],
    delivery: config?.delivery ?? "pull-request",
    acceptAlsoMerges: config?.acceptAlsoMerges ?? true,
    trackerSync: config?.trackerSync ?? "local",
    compactThresholdTokens: String(config?.compactThresholdTokens ?? 250_000),
    idleCompactThresholdTokens: String(config?.idleCompactThresholdTokens ?? 200_000),
    maxParallelOwners: String(config?.maxParallelOwners ?? 3),
  };
}

function settingsFrom(draft: Draft, defaultModel: string): ProjectSettings {
  return {
    repoPath: draft.repoPath.trim(),
    baseBranch: draft.baseBranch.trim(),
    ticketPrefix: draft.ticketPrefix.trim().toUpperCase(),
    manager: { model: draft.managerModel || defaultModel, thinking: draft.managerThinking },
    owner: { model: draft.ownerModel || defaultModel, thinking: draft.ownerThinking },
    subagentModels: draft.subagentModels,
    delivery: draft.delivery,
    acceptAlsoMerges: draft.acceptAlsoMerges,
    trackerSync: draft.trackerSync,
    compactThresholdTokens: Number.parseInt(draft.compactThresholdTokens, 10) || 250_000,
    idleCompactThresholdTokens: Number.parseInt(draft.idleCompactThresholdTokens, 10) || 200_000,
    maxParallelOwners: Math.max(1, Number.parseInt(draft.maxParallelOwners, 10) || 3),
  };
}

export function ProjectSetup({
  theme,
  existing,
  onDone,
}: {
  theme: PluginTheme;
  /** The project being edited, or null to add one. */
  existing: ProjectConfig | null;
  onDone: (project: string) => void;
}) {
  const toast = useToast();
  const prerequisitesRpc = useRpc(checkPrerequisites);
  const modelsRpc = useRpc(listModels);
  const onboard = useRpc(onboardProject);
  const save = useRpc(writeProjectSettings);
  const readOrders = useRpc(readStandingOrders);
  const writeOrders = useRpc(writeStandingOrders);
  const launch = useRpc(launchManager);
  const restart = useRpc(restartManager);

  const prerequisites = useQuery({ queryKey: ["taro", "prerequisites"], queryFn: () => prerequisitesRpc({}) });
  const models = useQuery({ queryKey: ["taro", "models"], queryFn: () => modelsRpc({}) });
  const modelOptions = models.data?.models ?? [];
  const defaultModel = useMemo(
    () => modelOptions.find((option) => /opus/i.test(option.id))?.id ?? modelOptions[0]?.id ?? "claude/claude-opus-5-5",
    [modelOptions],
  );
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing));
  const [orders, setOrders] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing === null) return;
    void readOrders({ project: existing.project }).then((result) => setOrders(result.text)).catch(() => setOrders(""));
  }, [existing?.project]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    setDraft((current) => ({
      ...current,
      managerModel: current.managerModel || defaultModel,
      ownerModel: current.ownerModel || defaultModel,
    }));
  }, [defaultModel, modelOptions.length]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseModel(role: "manager" | "owner", model: string): void {
    setDraft((current) =>
      role === "manager"
        ? { ...current, managerModel: model, managerThinking: thinkingAfterModelChange(modelOptions, model, current.managerThinking) }
        : { ...current, ownerModel: model, ownerThinking: thinkingAfterModelChange(modelOptions, model, current.ownerThinking) },
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      if (existing === null) {
        const result = await onboard({ project: draft.project.trim(), settings: settingsFrom(draft, defaultModel), startManager: true });
        toast.show(`${result.config.project} added; its manager is starting.`, { variant: "success" });
        onDone(result.config.project);
      } else {
        await save({ project: existing.project, settings: settingsFrom(draft, defaultModel) });
        if (orders !== null) await writeOrders({ project: existing.project, text: orders });
        toast.show("Saved.", { variant: "success" });
        onDone(existing.project);
      }
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function managerAction(kind: "launch" | "restart"): Promise<void> {
    if (existing === null) return;
    setBusy(true);
    try {
      await (kind === "launch" ? launch : restart)({ project: existing.project });
      toast.show(kind === "launch" ? "Manager started." : "Manager restarted.", { variant: "success" });
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const modelHint = models.isLoading ? "loading the model list…" : modelOptions.length === 0 ? "no provider listed models; saved values are kept" : undefined;
  const muted = { color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small };

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}>
      <SettingsSection title="Before you start">
        {(prerequisites.data?.checks ?? []).map((check) => (
          <SettingsRow key={check.name} label={`${check.ok ? "✓" : "✗"} ${check.name}`} hint={check.detail} />
        ))}
        {prerequisites.isLoading ? <SettingsRow label="Checking…" /> : null}
      </SettingsSection>

      <SettingsSection title="Project">
        {existing === null ? (
          <SettingsInput label="Name" hint="lowercase, used for folders and labels" initialValue={draft.project} onChangeText={(text) => update("project", text)} placeholder="shop" />
        ) : (
          <SettingsRow label="Name" hint={existing.project} />
        )}
        {existing === null ? (
          <SettingsInput label="Repository" hint="absolute path of a local git checkout" initialValue={draft.repoPath} onChangeText={(text) => update("repoPath", text)} placeholder="/home/you/code/app" />
        ) : (
          <SettingsRow label="Repository" hint={existing.repoPath} />
        )}
        <SettingsInput label="Base branch" initialValue={draft.baseBranch} onChangeText={(text) => update("baseBranch", text)} />
        {existing === null ? (
          <SettingsInput label="Ticket prefix" hint="capital letters, e.g. SH" initialValue={draft.ticketPrefix} onChangeText={(text) => update("ticketPrefix", text)} />
        ) : (
          <SettingsRow label="Ticket prefix" hint={existing.ticketPrefix} />
        )}
        <SettingsSelect
          label="Tickets"
          hint="the taro/backlog branch, kept on this machine or synced with the remote"
          value={draft.trackerSync}
          options={[
            { label: "This machine only", value: "local" },
            { label: "Synced with the remote", value: "remote" },
          ]}
          onValueChange={(value) => update("trackerSync", value)}
        />
      </SettingsSection>

      <SettingsSection title="Agents">
        <SettingsSelect
          label="Manager model"
          {...(modelHint === undefined ? {} : { hint: modelHint })}
          value={draft.managerModel}
          options={modelPickerOptions(modelOptions, [draft.managerModel])}
          onValueChange={(value) => chooseModel("manager", value)}
        />
        <SettingsSelect
          label="Manager thinking"
          value={draft.managerThinking}
          options={thinkingOptions(modelOptions, draft.managerModel, draft.managerThinking)}
          onValueChange={(value) => update("managerThinking", value)}
        />
        <SettingsSelect
          label="Task owner model"
          hint={modelHint ?? "the top tier is recommended"}
          value={draft.ownerModel}
          options={modelPickerOptions(modelOptions, [draft.ownerModel])}
          onValueChange={(value) => chooseModel("owner", value)}
        />
        <SettingsSelect
          label="Task owner thinking"
          value={draft.ownerThinking}
          options={thinkingOptions(modelOptions, draft.ownerModel, draft.ownerThinking)}
          onValueChange={(value) => update("ownerThinking", value)}
        />
        <SettingsRow label="Models owners may give subagents" hint="owners pick per task by difficulty; none selected means the owner's own model" />
        {/* Below the row, not inside it: a row's trailing slot squeezes its label to one letter wide. */}
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <ToggleChips
            theme={theme}
            selected={draft.subagentModels}
            options={modelPickerOptions(modelOptions, draft.subagentModels)}
            onToggle={(value) => setDraft((current) => ({ ...current, subagentModels: toggleSubagentModel(current.subagentModels, value) }))}
          />
        </View>
        <SettingsInput label="Owners running at once" hint="the manager queues the rest; each agent costs host resources" initialValue={draft.maxParallelOwners} onChangeText={(text) => update("maxParallelOwners", text)} />
        <SettingsInput label="Compact owners above (tokens)" initialValue={draft.compactThresholdTokens} onChangeText={(text) => update("compactThresholdTokens", text)} />
        <SettingsInput
          label="Compact idle agents above (tokens)"
          hint="an owner or the manager idle for 55 minutes, before its prompt cache expires"
          initialValue={draft.idleCompactThresholdTokens}
          onChangeText={(text) => update("idleCompactThresholdTokens", text)}
        />
        <SettingsRow label="Permissions" hint="task owners and their subagents run in bypass mode" />
      </SettingsSection>

      <SettingsSection title="Delivery">
        <SettingsSelect
          label="Delivery"
          value={draft.delivery}
          options={[
            { label: "Pull request", value: "pull-request" },
            { label: "Local branch only", value: "local-only" },
          ]}
          onValueChange={(value) => update("delivery", value)}
        />
        <SettingsSwitch label="Accept also merges" hint="pressing Accept lets the owner merge after checking the head is unchanged" value={draft.acceptAlsoMerges} onValueChange={(value) => update("acceptAlsoMerges", value)} />
      </SettingsSection>

      {existing === null ? null : (
        <SettingsSection title="Standing orders">
          {orders === null ? (
            <SettingsRow label="Loading…" />
          ) : (
            <SettingsInput label="Orders" hint="the manager copies the ones that apply into every brief" initialValue={orders} onChangeText={setOrders} />
          )}
        </SettingsSection>
      )}

      {existing === null ? null : (
        <SettingsSection title="Manager">
          <SettingsAction label="Start the manager" hint="when it has none" actionLabel="Start" disabled={busy} onPress={() => void managerAction("launch")} />
          <SettingsAction label="Restart the manager" hint="archives it and starts a fresh one; tickets are kept" actionLabel="Restart" disabled={busy} onPress={() => void managerAction("restart")} />
        </SettingsSection>
      )}

      <SettingsSection title={existing === null ? "Add the project" : "Save"}>
        <SettingsAction
          label={existing === null ? "Create the tracker and start the manager" : "Save these settings"}
          actionLabel={busy ? "Working…" : existing === null ? "Add project" : "Save"}
          disabled={busy}
          onPress={() => void submit()}
        />
      </SettingsSection>
      <View>
        <Text style={muted}>Tickets live on the taro/backlog branch of the repository, in a separate checkout Taro manages.</Text>
      </View>
    </ScrollView>
  );
}
