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
import type { ProjectConfig, ProjectSettings } from "../shared/project";
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
  helperModels: string;
  delivery: "pull-request" | "local-only";
  acceptAlsoMerges: boolean;
  trackerSync: "local" | "remote";
  compactThresholdTokens: string;
}

function draftFrom(config: ProjectConfig | null, defaultModel: string): Draft {
  return {
    project: config?.project ?? "",
    repoPath: config?.repoPath ?? "",
    baseBranch: config?.baseBranch ?? "main",
    ticketPrefix: config?.ticketPrefix ?? "",
    managerModel: config?.manager.model ?? defaultModel,
    managerThinking: config?.manager.thinking ?? "",
    ownerModel: config?.owner.model ?? defaultModel,
    ownerThinking: config?.owner.thinking ?? "",
    helperModels: config?.helperModels.join(", ") ?? "",
    delivery: config?.delivery ?? "pull-request",
    acceptAlsoMerges: config?.acceptAlsoMerges ?? true,
    trackerSync: config?.trackerSync ?? "local",
    compactThresholdTokens: String(config?.compactThresholdTokens ?? 250_000),
  };
}

function settingsFrom(draft: Draft): ProjectSettings {
  return {
    repoPath: draft.repoPath.trim(),
    baseBranch: draft.baseBranch.trim(),
    ticketPrefix: draft.ticketPrefix.trim().toUpperCase(),
    manager: { model: draft.managerModel.trim(), thinking: draft.managerThinking.trim() },
    owner: { model: draft.ownerModel.trim(), thinking: draft.ownerThinking.trim() },
    helperModels: draft.helperModels.split(",").map((model) => model.trim()).filter((model) => model !== ""),
    delivery: draft.delivery,
    acceptAlsoMerges: draft.acceptAlsoMerges,
    trackerSync: draft.trackerSync,
    compactThresholdTokens: Number.parseInt(draft.compactThresholdTokens, 10) || 250_000,
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing, defaultModel));
  const [orders, setOrders] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing === null) return;
    void readOrders({ project: existing.project }).then((result) => setOrders(result.text)).catch(() => setOrders(""));
  }, [existing?.project]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      if (existing === null) {
        const result = await onboard({ project: draft.project.trim(), settings: settingsFrom(draft), startManager: true });
        toast.show(`${result.config.project} added; its manager is starting.`, { variant: "success" });
        onDone(result.config.project);
      } else {
        await save({ project: existing.project, settings: settingsFrom(draft) });
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

  const modelHint = modelOptions.length === 0 ? "provider/model" : `e.g. ${modelOptions.slice(0, 3).map((option) => option.id).join(", ")}`;
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
        <SettingsInput label="Manager model" hint={modelHint} initialValue={draft.managerModel} onChangeText={(text) => update("managerModel", text)} />
        <SettingsInput label="Manager thinking" hint="empty for the provider's default" initialValue={draft.managerThinking} onChangeText={(text) => update("managerThinking", text)} />
        <SettingsInput label="Task owner model" hint="the top tier is recommended" initialValue={draft.ownerModel} onChangeText={(text) => update("ownerModel", text)} />
        <SettingsInput label="Task owner thinking" initialValue={draft.ownerThinking} onChangeText={(text) => update("ownerThinking", text)} />
        <SettingsInput label="Models owners may give helpers" hint="comma-separated; owners pick per task by difficulty" initialValue={draft.helperModels} onChangeText={(text) => update("helperModels", text)} />
        <SettingsInput label="Compact owners above (tokens)" initialValue={draft.compactThresholdTokens} onChangeText={(text) => update("compactThresholdTokens", text)} />
        <SettingsRow label="Permissions" hint="task owners and helpers run in bypass mode" />
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
