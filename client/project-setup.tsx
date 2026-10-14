/**
 * The full-page project setup (decisions 13, 14): prerequisite checks, project,
 * agents, delivery, limits, standing orders. The same page edits an existing project.
 * Drawn as section cards with descriptions (TR-019); the form's logic is in shared/setup-form.ts.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  checkPrerequisites,
  launchManager,
  listModels,
  readStandingOrders,
  restartManager,
  writeProjectSettings,
  writeStandingOrders,
} from "../shared/contracts";
import { modelOptions as modelPickerOptions, thinkingAfterModelChange, thinkingOptions, toggleSubagentModel } from "../shared/model-picker";
import type { ProjectConfig } from "../shared/project";
import { draftFrom, settingsFrom, setupProblems, ticketExample, type SetupDraft, type SetupProblems } from "../shared/setup-form";
import { errorText } from "./format";
import { KeyboardScrollView } from "./keyboard";
import { CheckLine, ChoiceCards, Dropdown, Field, FixedValue, FormSection, ModelChooser, TextField, TWO_COLUMN_MIN_WIDTH } from "./settings-form";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { useActions } from "./use-actions";

const PAGE_MAX_WIDTH = 760;

export function ProjectSetup({
  theme,
  existing,
  initial = null,
  error = null,
  onCreate,
  onDone,
  onCancel,
}: {
  theme: PluginTheme;
  /** The project being edited, or null to add one. */
  existing: ProjectConfig | null;
  /** A new project's values filled in from a picked Paseo project (TR-056); null for an empty form. */
  initial?: SetupDraft | null;
  /** Why creating failed after its check passed, shown above the button. */
  error?: string | null;
  /** Creates a new project; resolves with the problems by field when its check finds any. */
  onCreate?: (draft: SetupDraft) => Promise<SetupProblems | null>;
  /** After saving an existing project's settings. */
  onDone?: (project: string) => void;
  /** Leaves without saving; null when there is nowhere to go back to (no project yet). */
  onCancel: (() => void) | null;
}) {
  const toast = useToast();
  const prerequisitesRpc = useRpc(checkPrerequisites);
  const modelsRpc = useRpc(listModels);
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
  const [draft, setDraft] = useState<SetupDraft>(() => initial ?? draftFrom(existing));
  const [serverProblems, setServerProblems] = useState<SetupProblems>({});
  const [failure, setFailure] = useState<string | null>(error);
  const [orders, setOrders] = useState<string | null>(null);
  const presses = useActions();
  const busy = presses.busy;
  // A field shows its problem once typed in, so a fresh form is not a wall of red; the footer says why saving is off.
  const [touched, setTouched] = useState<ReadonlySet<keyof SetupDraft>>(() => new Set());
  const [width, setWidth] = useState(0);
  const wide = width >= TWO_COLUMN_MIN_WIDTH;

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

  const problems = setupProblems(draft, existing === null);
  const valid = Object.keys(problems).length === 0;
  // A filled-in draft shows its problems at once; the server's stay on their field until it changes.
  const problem = (key: keyof SetupDraft): string | null =>
    serverProblems[key] ?? (touched.has(key) || initial !== null ? (problems[key] ?? null) : null);

  function update<Key extends keyof SetupDraft>(key: Key, value: SetupDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    if (serverProblems[key] !== undefined) setServerProblems(({ [key]: _gone, ...rest }) => rest);
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  }

  function chooseModel(role: "manager" | "owner", model: string): void {
    setDraft((current) =>
      role === "manager"
        ? { ...current, managerModel: model, managerThinking: thinkingAfterModelChange(modelOptions, model, current.managerThinking) }
        : { ...current, ownerModel: model, ownerThinking: thinkingAfterModelChange(modelOptions, model, current.ownerThinking) },
    );
  }

  function submit(): void {
    if (existing === null) {
      setFailure(null);
      // Fields the server refused fail the press (the button comes back) and are said in a toast; anything else shows on the page.
      const fieldProblems = new Error("Fix the fields marked in red to continue.");
      // Held after success: the page gives way to the creation's progress.
      presses.press(
        "submit",
        async () => {
          const found = (await onCreate?.(draft)) ?? null;
          if (found === null) return;
          setServerProblems(found);
          throw fieldProblems;
        },
        { after: "hold", onError: (caught) => (caught === fieldProblems ? toast.error(fieldProblems.message) : setFailure(errorText(caught))) },
      );
      return;
    }
    presses.press(
      "submit",
      async () => {
        await save({ project: existing.project, settings: settingsFrom(draft, defaultModel) });
        if (orders !== null) await writeOrders({ project: existing.project, text: orders });
      },
      { success: "Saved.", onSuccess: () => onDone?.(existing.project) },
    );
  }

  function managerAction(kind: "launch" | "restart"): void {
    if (existing === null) return;
    presses.press(kind, () => (kind === "launch" ? launch : restart)({ project: existing.project }), { success: kind === "launch" ? "Manager started." : "Manager restarted." });
  }

  const colors = theme.colors;
  // Until the list arrives every saved model is missing from it; name them plainly instead of "not listed".
  const pickerOptions = (saved: readonly string[]) =>
    models.isLoading ? saved.filter((id) => id !== "").map((id) => ({ label: id, value: id })) : modelPickerOptions(modelOptions, saved);
  const modelHint = models.isLoading ? "Loading the model list…" : modelOptions.length === 0 ? "No provider listed models; saved values are kept." : null;
  const checks = prerequisites.data?.checks ?? [];
  // An existing project passed its checks when it was added; its page shows them again only when one fails.
  const showChecks = existing === null || checks.some((check) => !check.ok);
  const example = ticketExample(existing?.ticketPrefix ?? draft.ticketPrefix);
  const branch = draft.baseBranch.trim() === "" ? "this branch" : draft.baseBranch.trim();
  const muted = { color: colors.foregroundMuted, fontSize: FONT_SIZE.small };

  const modelRow = (role: "manager" | "owner", label: string) => {
    const model = role === "manager" ? draft.managerModel : draft.ownerModel;
    const thinking = role === "manager" ? draft.managerThinking : draft.ownerThinking;
    return (
      <View style={{ flexDirection: wide ? "row" : "column", gap: SPACE.sm }}>
        <View style={{ flex: wide ? 3 : undefined }}>
          <Dropdown theme={theme} title={`${label} model`} value={model} options={pickerOptions([model])} onChange={(value) => chooseModel(role, value)} />
        </View>
        <View style={{ flex: wide ? 2 : undefined }}>
          <Dropdown
            theme={theme}
            title={`${label} thinking`}
            value={thinking}
            options={thinkingOptions(modelOptions, model, thinking)}
            onChange={(value) => update(role === "manager" ? "managerThinking" : "ownerThinking", value)}
          />
        </View>
      </View>
    );
  };

  return (
    <KeyboardScrollView
      onLayout={(event) => setWidth(Math.min(PAGE_MAX_WIDTH, event.nativeEvent.layout.width))}
      contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl * 2, gap: SPACE.lg, maxWidth: PAGE_MAX_WIDTH, width: "100%", alignSelf: "center" }}
    >
      <View style={{ gap: SPACE.sm }}>
        {onCancel === null ? null : (
          <Pressable accessibilityRole="link" disabled={busy} onPress={onCancel} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }}>
            <Icon name="ChevronLeft" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: FONT_SIZE.small }}>{existing === null ? "Back" : `Back to ${existing.project}`}</Text>
          </Pressable>
        )}
        <Text style={{ color: colors.foreground, fontSize: wide ? FONT_SIZE.display : FONT_SIZE.heading, fontWeight: "700" }}>
          {existing === null ? "Add a project" : `${existing.project} settings`}
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>
          {existing === null
            ? "Taro gives the project its own ticket tracker and a Manager. You talk to the Manager; it looks into each request, files a ticket and starts a task owner."
            : "Changes apply to agents started from now on. Running agents keep their settings."}
        </Text>
      </View>

      {showChecks ? (
        <FormSection theme={theme} icon="ListChecks" title="Before you start" description="What Taro needs on this machine.">
          <View style={{ gap: SPACE.sm }}>
            {checks.map((check) => (
              <CheckLine key={check.name} theme={theme} ok={check.ok} name={check.name} detail={check.detail} />
            ))}
            {prerequisites.isLoading ? <Text style={muted}>Checking…</Text> : null}
          </View>
        </FormSection>
      ) : null}

      <FormSection theme={theme} icon="FolderGit2" title="Project" description="The repository Taro works in and where its tickets live.">
        <Field theme={theme} wide={wide} label="Name" hint={existing === null ? "Lowercase letters, digits and dashes; used for folders and labels." : null} error={problem("project")}>
          {existing === null ? (
            <TextField theme={theme} accessibilityLabel="Name" value={draft.project} onChangeText={(text) => update("project", text)} placeholder="shop" invalid={problem("project") !== null} />
          ) : (
            <FixedValue theme={theme} text={existing.project} />
          )}
        </Field>
        <Field theme={theme} wide={wide} label="Repository" hint={existing === null ? "The absolute path of a local git checkout." : null} error={problem("repoPath")}>
          {existing === null ? (
            <TextField
              theme={theme}
              accessibilityLabel="Repository"
              value={draft.repoPath}
              onChangeText={(text) => update("repoPath", text)}
              placeholder="/home/you/code/shop"
              invalid={problem("repoPath") !== null}
            />
          ) : (
            <FixedValue theme={theme} text={existing.repoPath} monospace />
          )}
        </Field>
        <Field theme={theme} wide={wide} label="Base branch" hint={`Task owners branch off ${branch} and deliver back to it.`} error={problem("baseBranch")}>
          <TextField theme={theme} accessibilityLabel="Base branch" value={draft.baseBranch} onChangeText={(text) => update("baseBranch", text)} invalid={problem("baseBranch") !== null} />
        </Field>
        <Field
          theme={theme}
          wide={wide}
          label="Ticket prefix"
          hint={existing === null ? `One to eight capital letters.${example === null ? "" : ` Tickets look like ${example}.`}` : example === null ? null : `Tickets look like ${example}.`}
          error={problem("ticketPrefix")}
        >
          {existing === null ? (
            <TextField
              theme={theme}
              accessibilityLabel="Ticket prefix"
              value={draft.ticketPrefix}
              onChangeText={(text) => update("ticketPrefix", text.toUpperCase())}
              placeholder="SH"
              invalid={problem("ticketPrefix") !== null}
            />
          ) : (
            <FixedValue theme={theme} text={existing.ticketPrefix} />
          )}
        </Field>
        <Field theme={theme} wide={wide} label="Tickets">
          <ChoiceCards
            theme={theme}
            value={draft.trackerSync}
            onChange={(value) => update("trackerSync", value)}
            options={[
              { value: "local", title: "This machine only", description: "The taro/backlog branch stays in this checkout; nothing is pushed." },
              { value: "remote", title: "Synced with the remote", description: "Ticket changes are pushed to the taro/backlog branch, so other machines see the same board." },
            ]}
          />
        </Field>
      </FormSection>

      <FormSection theme={theme} icon="Bot" title="Agents" description="The models Taro starts its agents with. Task owners and their subagents run in bypass mode.">
        <Field theme={theme} wide={wide} label="Manager" hint={modelHint ?? "Reads and routes your requests, so a mid-size model is enough."}>
          {modelRow("manager", "Manager")}
        </Field>
        <Field theme={theme} wide={wide} label="Task owner" hint={modelHint ?? "Plans, builds and delivers each ticket; the top tier is recommended."}>
          {modelRow("owner", "Task owner")}
        </Field>
        <Field
          theme={theme}
          wide={wide}
          label="Subagent models"
          hint="Owners pick from these per task by difficulty: the cheapest for mechanical work, the strongest for hard problems."
        >
          <ModelChooser
            theme={theme}
            options={pickerOptions(draft.subagentModels)}
            selected={draft.subagentModels}
            emptyText="None chosen: subagents get their owner's model."
            onAdd={(value) => setDraft((current) => ({ ...current, subagentModels: toggleSubagentModel(current.subagentModels, value) }))}
            onRemove={(value) => setDraft((current) => ({ ...current, subagentModels: toggleSubagentModel(current.subagentModels, value) }))}
          />
        </Field>
      </FormSection>

      <FormSection theme={theme} icon="GitPullRequest" title="How work is delivered" description="Where a task owner stops, and what pressing Accept does.">
        <Field theme={theme} wide={wide} label="Finish line">
          <ChoiceCards
            theme={theme}
            value={draft.delivery}
            onChange={(value) => update("delivery", value)}
            options={[
              { value: "pull-request", title: "Pull request", description: "The owner pushes its branch, opens a pull request, has it reviewed and marks it ready." },
              { value: "local-only", title: "Local branch only", description: "The owner leaves a clean branch that fast-forwards from the base branch. Nothing is pushed." },
            ]}
          />
        </Field>
        <Field theme={theme} wide={wide} label="Merging">
          <ChoiceCards
            theme={theme}
            value={draft.acceptAlsoMerges ? "on-accept" : "manual"}
            onChange={(value) => update("acceptAlsoMerges", value === "on-accept")}
            options={[
              { value: "on-accept", title: "Merge when accepted", description: "After you press Accept, the owner merges once it has checked the reviewed head is unchanged." },
              { value: "manual", title: "You merge", description: "Accept closes the ticket; merging stays with you." },
            ]}
          />
        </Field>
      </FormSection>

      <FormSection theme={theme} icon="Gauge" title="Limits" description="How much runs at once, and when long conversations are compacted.">
        <Field theme={theme} wide={wide} label="Owners running at once" hint="The Manager queues the rest; every agent costs host resources and money." error={problem("maxParallelOwners")}>
          <TextField
            theme={theme}
            accessibilityLabel="Owners running at once"
            value={draft.maxParallelOwners}
            onChangeText={(text) => update("maxParallelOwners", text)}
            invalid={problem("maxParallelOwners") !== null}
          />
        </Field>
        <Field theme={theme} wide={wide} label="Compact owners above" hint="Tokens of context; a busy owner above this is asked to hand off and compact." error={problem("compactThresholdTokens")}>
          <TextField
            theme={theme}
            accessibilityLabel="Compact owners above"
            value={draft.compactThresholdTokens}
            onChangeText={(text) => update("compactThresholdTokens", text)}
            invalid={problem("compactThresholdTokens") !== null}
          />
        </Field>
        <Field
          theme={theme}
          wide={wide}
          label="Compact idle agents above"
          hint="Tokens of context; an owner or the Manager idle for 55 minutes is compacted before its prompt cache expires."
          error={problem("idleCompactThresholdTokens")}
        >
          <TextField
            theme={theme}
            accessibilityLabel="Compact idle agents above"
            value={draft.idleCompactThresholdTokens}
            onChangeText={(text) => update("idleCompactThresholdTokens", text)}
            invalid={problem("idleCompactThresholdTokens") !== null}
          />
        </Field>
      </FormSection>

      {existing === null ? null : (
        <FormSection
          theme={theme}
          icon="ScrollText"
          title="Standing orders"
          tag="optional"
          description="Rules for this project on top of the repository's own instructions; the Manager copies the ones that apply into every brief."
        >
          {orders === null ? (
            <Text style={muted}>Loading…</Text>
          ) : (
            <TextField theme={theme} accessibilityLabel="Standing orders" value={orders} onChangeText={setOrders} placeholder="e.g. Run the end-to-end tests before delivering." multiline />
          )}
        </FormSection>
      )}

      {existing === null ? null : (
        <FormSection theme={theme} icon="UserCog" title="Manager" description="Start a Manager when the project has none, or restart it fresh. Tickets are kept either way.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
            <IconButton theme={theme} icon="Play" label="Start Manager" showLabel disabled={busy} state={presses.stateOf("launch")} onPress={() => managerAction("launch")} />
            <IconButton theme={theme} icon="RotateCcw" label="Restart Manager" showLabel disabled={busy} state={presses.stateOf("restart")} onPress={() => managerAction("restart")} />
          </View>
        </FormSection>
      )}

      {failure === null ? null : <Text style={[muted, { color: colors.statusDanger }]}>{failure}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: SPACE.sm }}>
        {valid ? null : (
          <Text style={[muted, { flexGrow: 1, flexBasis: 200 }]}>
            {existing === null ? "Fill in the project's name, repository and ticket prefix to continue." : "Fix the fields marked in red to save."}
          </Text>
        )}
        {onCancel === null ? null : <IconButton theme={theme} icon="X" label="Cancel" showLabel disabled={busy} onPress={onCancel} />}
        <IconButton
          theme={theme}
          tone="accent"
          icon={existing === null ? "Rocket" : "Check"}
          label={existing === null ? "Create tracker and start Manager" : "Save"}
          showLabel
          disabled={busy || !valid}
          state={presses.stateOf("submit")}
          onPress={submit}
        />
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }}>
        Tickets live on the taro/backlog branch of the repository, in a separate checkout Taro manages.
      </Text>
    </KeyboardScrollView>
  );
}
