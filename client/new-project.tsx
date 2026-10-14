/**
 * New project (TR-056): pick one of Paseo's projects, review the few values a user might change,
 * create. "All settings" and "Add manually" open the full form (`project-setup.tsx`). While the
 * tracker and Manager are set up the screen shows `CreationProgress`. The list's order, the
 * suggestions and the defaults are in shared/project-candidates.ts.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { checkOnboarding, launchManager, listPaseoProjects, onboardProject } from "../shared/contracts";
import {
  candidateDraft,
  filterCandidates,
  remoteLabel,
  settingsSummary,
  sortCandidates,
  type PaseoProjectCandidate,
  type SettingsTemplate,
} from "../shared/project-candidates";
import { deliveryWithoutGh, pullRequestsReady, setupProblems, settingsFrom, ticketExample, type SetupDraft, type SetupProblems } from "../shared/setup-form";
import { errorText } from "./format";
import { KeyboardScrollView } from "./keyboard";
import { keptMap, keptObject } from "./kept";
import { creation, retryManager, startCreation, type CreationState } from "./project-creation";
import { PrerequisiteList, usePrerequisites } from "./prerequisite-list";
import { ProjectSetup } from "./project-setup";
import { useModels } from "./queries";
import { ChoiceCards, Field, FormSection, TextField, TWO_COLUMN_MIN_WIDTH } from "./settings-form";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, MONOSPACE, Spinner } from "./ui";
import { usePressGuards } from "./use-actions";

const PAGE_MAX_WIDTH = 760;
const PICKER_REFRESH_MS = 5_000;

type Page = "list" | "review" | "form";

/** Where New project is, kept across remounts and reconnects (`kept.ts`): Back returns to the list with its search. */
const kept = keptObject(globalThis, "new-project-v1", {
  page: "list" as Page,
  search: "",
  /** The form was opened from a picked project, so its Back returns to the review page. */
  picked: false,
  /** Why creating failed after the check passed, shown above Create. */
  error: null as string | null,
});
const keptDraft = keptMap<"draft", SetupDraft>(globalThis, "new-project-draft-v1");

/** Starts New project afresh: the list, no search, no draft. */
export function resetNewProject(): void {
  Object.assign(kept, { page: "list", search: "", picked: false, error: null });
  keptDraft.clear();
}

/** After a failed tracker step: back to the page the user created from, with the reason. */
export function returnToNewProject(error: string): void {
  kept.error = error;
}

export function NewProject({
  theme,
  compact,
  onOpenProject,
  onCreating,
  onCancel,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** Opens a project already in Taro. */
  onOpenProject: (project: string) => void;
  /** Creating has started; the screen shows its progress. */
  onCreating: () => void;
  /** Leaves; null when there is no project to go back to. */
  onCancel: (() => void) | null;
}) {
  const models = useModels();
  const calls = { check: useRpc(checkOnboarding), onboard: useRpc(onboardProject), launch: useRpc(launchManager) };
  const load = useRpc(listPaseoProjects);
  const [page, setPageState] = useState<Page>(kept.page);
  // Polled while the list is open, so a project added to or removed from Paseo shows within seconds.
  const listing = useQuery({ queryKey: ["taro", "paseo-projects"], queryFn: () => load({}), refetchInterval: page === "list" ? PICKER_REFRESH_MS : false });
  const [search, setSearchState] = useState(kept.search);
  const [draft, setDraftState] = useState<SetupDraft | null>(() => keptDraft.get("draft") ?? null);
  const [error, setErrorState] = useState<string | null>(kept.error);

  const setPage = (next: Page, picked = kept.picked) => {
    Object.assign(kept, { page: next, picked });
    setPageState(next);
  };
  const setSearch = (next: string) => {
    kept.search = next;
    setSearchState(next);
  };
  const setDraft = (next: SetupDraft | null) => {
    if (next === null) keptDraft.delete("draft");
    else keptDraft.set("draft", next);
    setDraftState(next);
  };
  const setError = (next: string | null) => {
    kept.error = next;
    setErrorState(next);
  };

  async function create(next: SetupDraft): Promise<SetupProblems | null> {
    setDraft(next);
    setError(null);
    const result = await startCreation(calls, next.project.trim(), settingsFrom(next, models.defaultModel));
    if (result.problems !== null) return result.problems;
    onCreating();
    return null;
  }

  if (page === "form") {
    return (
      <ProjectSetup
        theme={theme}
        existing={null}
        initial={draft}
        error={error}
        onCreate={create}
        onCancel={() => setPage(kept.picked && draft !== null ? "review" : "list")}
      />
    );
  }
  if (page === "review" && draft !== null) {
    return (
      <ProjectReview
        theme={theme}
        compact={compact}
        draft={draft}
        candidate={listing.data?.projects.find((entry) => entry.repoPath === draft.repoPath) ?? null}
        template={listing.data?.template ?? null}
        error={error}
        onChange={setDraft}
        onCreate={create}
        onAllSettings={() => setPage("form", true)}
        onBack={() => {
          setError(null);
          setPage("list");
        }}
      />
    );
  }
  return (
    <ProjectPicker
      theme={theme}
      compact={compact}
      listing={listing}
      search={search}
      onSearch={setSearch}
      onPick={(candidate) => {
        setError(null);
        setDraft(candidateDraft(candidate, listing.data?.template ?? null, listing.data?.takenPrefixes ?? []));
        setPage("review", true);
      }}
      onOpenProject={onOpenProject}
      onManual={() => {
        setError(null);
        setDraft(null);
        setPage("form", false);
      }}
      onCancel={onCancel}
    />
  );
}

function deliveryHint(template: SettingsTemplate | null, pullRequests: boolean | null): string {
  const source = template === null ? "Taro's defaults; change them in All settings." : `As in ${template.project}; change them in All settings.`;
  return pullRequests === false ? `${source} Pull requests need gh: install it and run \`gh auth login\`.` : source;
}

type Listing = UseQueryResult<{ projects: PaseoProjectCandidate[]; template: SettingsTemplate | null; takenPrefixes: string[] }>;

function ProjectPicker({
  theme,
  compact,
  listing,
  search,
  onSearch,
  onPick,
  onOpenProject,
  onManual,
  onCancel,
}: {
  theme: PluginTheme;
  compact: boolean;
  listing: Listing;
  search: string;
  onSearch: (text: string) => void;
  onPick: (candidate: PaseoProjectCandidate) => void;
  onOpenProject: (project: string) => void;
  onManual: () => void;
  onCancel: (() => void) | null;
}) {
  const prerequisites = usePrerequisites();
  // A check that failed stays listed once fixed, so Install visibly turns it green.
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(() => new Set());
  const [width, setWidth] = useState(0);
  const wide = width >= TWO_COLUMN_MIN_WIDTH;
  const colors = theme.colors;

  const all = useMemo(() => sortCandidates(listing.data?.projects ?? []), [listing.data]);
  const shown = filterCandidates(all, search);
  const fresh = shown.filter((candidate) => candidate.taroProject === null);
  const onboarded = shown.filter((candidate) => candidate.taroProject !== null);
  const checks = prerequisites.data?.checks ?? [];
  const failingIds = checks.filter((check) => !check.ok).map((check) => check.id);
  useEffect(() => {
    if (failingIds.some((id) => !flagged.has(id))) setFlagged((current) => new Set([...current, ...failingIds]));
  }, [failingIds.join(" ")]);
  const failing = checks.filter((check) => !check.ok || flagged.has(check.id));
  const muted = { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const nothingInPaseo = listing.data !== undefined && all.length === 0;

  const row = (candidate: PaseoProjectCandidate, index: number) => {
    const inTaro = candidate.taroProject;
    const remote = remoteLabel(candidate.remoteUrl) ?? "No remote";
    return (
      <Pressable
        key={candidate.paseoProjectId}
        accessibilityRole="button"
        accessibilityLabel={inTaro === null ? `Add ${candidate.name}` : `Open ${inTaro}`}
        onPress={() => (inTaro === null ? onPick(candidate) : onOpenProject(inTaro))}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.md,
          paddingHorizontal: SPACE.lg,
          paddingVertical: SPACE.md,
          borderTopWidth: index === 0 ? 0 : 1,
          borderTopColor: colors.border,
          backgroundColor: pressed ? colors.surface2 : "transparent",
          opacity: inTaro === null ? 1 : 0.55,
        })}
      >
        <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }}>
          <Icon name={inTaro === null ? "FolderGit2" : "Check"} size={16} color={inTaro === null ? colors.foreground : colors.foregroundMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: SPACE.xxs }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }}>
            {candidate.name}
            {inTaro !== null && inTaro !== candidate.name ? <Text style={{ color: colors.foregroundMuted, fontWeight: "400" }}>{`  · ${inTaro} in Taro`}</Text> : null}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE }}>
            {candidate.repoPath}
          </Text>
          {wide ? null : (
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>
              {remote}
            </Text>
          )}
        </View>
        {wide ? (
          <Text numberOfLines={1} style={{ width: 220, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>
            {remote}
          </Text>
        ) : null}
        {inTaro === null ? (
          <Icon name="ChevronRight" size={16} color={colors.foregroundMuted} />
        ) : (
          <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, borderWidth: 1, borderColor: colors.border, borderRadius: 99, paddingHorizontal: SPACE.sm, paddingVertical: 1 }}>
            In Taro
          </Text>
        )}
      </Pressable>
    );
  };

  const list = (entries: PaseoProjectCandidate[]) => (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden" }}>{entries.map(row)}</View>
  );

  const manualLink = (
    <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: SPACE.xs }}>
      <Text style={muted}>Not listed?</Text>
      <Pressable accessibilityRole="link" onPress={onManual}>
        <Text style={[muted, { color: colors.accent }]}>Add manually</Text>
      </Pressable>
    </View>
  );

  return (
    <KeyboardScrollView
      keyboardShouldPersistTaps="handled"
      onLayout={(event) => setWidth(Math.min(PAGE_MAX_WIDTH, event.nativeEvent.layout.width))}
      contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl * 2, gap: SPACE.lg, maxWidth: PAGE_MAX_WIDTH, width: "100%", alignSelf: "center" }}
    >
      <View style={{ gap: SPACE.sm }}>
        {onCancel === null ? null : <BackLink theme={theme} label="Back" onPress={onCancel} />}
        <Text style={{ color: colors.foreground, fontSize: wide ? FONT_SIZE.display : FONT_SIZE.heading, fontWeight: "700" }}>Add a project</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>
          {nothingInPaseo
            ? "Taro gives a project its own ticket tracker and a Manager."
            : "Pick one of Paseo's projects. Taro gives it its own ticket tracker and a Manager you talk to."}
        </Text>
      </View>

      {failing.length === 0 ? null : (
        <FormSection theme={theme} icon="ListChecks" title="Before you start" description="Taro needs these on this machine.">
          <PrerequisiteList theme={theme} checks={failing} />
        </FormSection>
      )}

      {nothingInPaseo ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, padding: SPACE.xl, gap: SPACE.md, alignItems: "flex-start" }}>
          <Icon name="FolderGit2" size={22} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.subtitle, fontWeight: "600" }}>Paseo has no projects yet</Text>
          <Text style={muted}>
            Projects you open in Paseo show up here, ready to pick. Until then, add a repository by its path on this machine.
          </Text>
          <IconButton theme={theme} tone="accent" icon="Plus" label="Add manually" showLabel onPress={onManual} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
            <View style={{ flex: 1 }}>
              <TextField theme={theme} accessibilityLabel="Search Paseo's projects" value={search} onChangeText={onSearch} placeholder="Search Paseo's projects" autoFocus={!compact} />
            </View>
          </View>
          {listing.isLoading ? <Text style={muted}>Loading Paseo's projects…</Text> : null}
          {listing.error !== null && listing.data === undefined ? <Text style={[muted, { color: colors.statusDanger }]}>{errorText(listing.error)}</Text> : null}
          {listing.data !== undefined && shown.length === 0 ? <Text style={muted}>{`No project matches "${search.trim()}".`}</Text> : null}
          {fresh.length > 0 ? list(fresh) : null}
          {listing.data !== undefined && fresh.length === 0 && onboarded.length > 0 && search.trim() === "" ? (
            <Text style={muted}>Every Paseo project is in Taro already.</Text>
          ) : null}
          {onboarded.length > 0 ? (
            <View style={{ gap: SPACE.sm }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginLeft: SPACE.xxs }}>
                Already in Taro
              </Text>
              {list(onboarded)}
            </View>
          ) : null}
          {manualLink}
        </>
      )}
    </KeyboardScrollView>
  );
}

function BackLink({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="link"
      disabled={disabled}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, alignSelf: "flex-start", opacity: disabled ? 0.5 : 1 }}
    >
      <Icon name="ChevronLeft" size={14} color={theme.colors.accent} />
      <Text style={{ color: theme.colors.accent, fontSize: FONT_SIZE.small }}>{label}</Text>
    </Pressable>
  );
}

/** The fields the review page asks about; the rest come from the last project or the defaults. */
const REVIEW_FIELDS = ["project", "ticketPrefix", "baseBranch", "trackerSync"] as const;

function ProjectReview({
  theme,
  compact,
  draft,
  candidate,
  template,
  error,
  onChange,
  onCreate,
  onAllSettings,
  onBack,
}: {
  theme: PluginTheme;
  compact: boolean;
  draft: SetupDraft;
  /** The picked project as Paseo lists it; null until the list is loaded again after a reconnect. */
  candidate: PaseoProjectCandidate | null;
  template: SettingsTemplate | null;
  error: string | null;
  onChange: (draft: SetupDraft) => void;
  onCreate: (draft: SetupDraft) => Promise<SetupProblems | null>;
  onAllSettings: () => void;
  onBack: () => void;
}) {
  const models = useModels();
  const pullRequests = pullRequestsReady(usePrerequisites().data?.checks);
  const guardFor = usePressGuards();
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<SetupProblems>({});
  const [failure, setFailure] = useState<string | null>(error);
  const [width, setWidth] = useState(0);
  const wide = width >= TWO_COLUMN_MIN_WIDTH;
  const colors = theme.colors;
  useEffect(() => setFailure(error), [error]);
  // Picked before the checks arrived, or gh went away: pull requests fall back to a local branch.
  useEffect(() => {
    const fitted = deliveryWithoutGh(draft, pullRequests);
    if (fitted !== draft) onChange(fitted);
  }, [pullRequests, draft.delivery]);

  const local = setupProblems(draft, true);
  // Every field starts filled, so a problem shows at once; the server's are for the field until it changes.
  const problem = (key: keyof SetupDraft): string | null => serverProblems[key] ?? local[key] ?? null;
  const otherProblems = Object.keys(local).filter((key) => !(REVIEW_FIELDS as readonly string[]).includes(key));
  const valid = Object.keys(local).length === 0;
  const remote = candidate === null ? null : remoteLabel(candidate.remoteUrl);
  const canSync = candidate === null || remote !== null;
  const example = ticketExample(draft.ticketPrefix);
  const branch = draft.baseBranch.trim() === "" ? "this branch" : draft.baseBranch.trim();
  const muted = { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const effective = { ...draft, managerModel: draft.managerModel || models.defaultModel, ownerModel: draft.ownerModel || models.defaultModel };
  const summary = settingsSummary(models.query.isLoading && draft.managerModel === "" ? draft : effective, models.label);

  function update<Key extends keyof SetupDraft>(key: Key, value: SetupDraft[Key]): void {
    onChange({ ...draft, [key]: value });
    if (serverProblems[key] !== undefined) setServerProblems(({ [key]: _gone, ...rest }) => rest);
  }

  function submit(): void {
    // The guard, not `busy`, stops a second tap in the same frame; the reason for a failure shows above Create.
    const running = guardFor("create").run("create", () => onCreate(draft));
    if (running === null) return;
    setBusy(true);
    setFailure(null);
    void running.then((outcome) => {
      setBusy(false);
      if (!outcome.ok) {
        setFailure(errorText(outcome.error));
        return;
      }
      const problems = outcome.value;
      if (problems === null) return;
      setServerProblems(problems);
      const elsewhere = Object.keys(problems).filter((key) => !(REVIEW_FIELDS as readonly string[]).includes(key));
      if (elsewhere.length > 0) setFailure(elsewhere.map((key) => problems[key as keyof SetupDraft]).join(" "));
    });
  }

  const createButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create tracker and start Manager"
      accessibilityState={{ busy, disabled: busy || !valid }}
      disabled={busy || !valid}
      onPress={submit}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACE.sm,
        backgroundColor: colors.accent,
        opacity: !valid ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <Spinner size={16} color={colors.accentForeground} /> : <Icon name="Rocket" size={16} color={colors.accentForeground} />}
      <Text style={{ color: colors.accentForeground, fontSize: FONT_SIZE.body, fontWeight: "700" }}>Create tracker and start Manager</Text>
    </Pressable>
  );
  const allSettings = (
    <Pressable accessibilityRole="link" disabled={busy} onPress={onAllSettings} style={{ alignSelf: "center", paddingVertical: SPACE.xs }}>
      <Text style={muted}>All settings…</Text>
    </Pressable>
  );
  const footer = (
    <View style={{ gap: SPACE.sm }}>
      {failure === null ? null : <Text style={[muted, { color: colors.statusDanger }]}>{failure}</Text>}
      {valid || otherProblems.length === 0 ? null : <Text style={[muted, { color: colors.statusDanger }]}>Some settings need fixing: open All settings.</Text>}
      {createButton}
      {allSettings}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <KeyboardScrollView
        onLayout={(event) => setWidth(Math.min(PAGE_MAX_WIDTH, event.nativeEvent.layout.width))}
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: compact ? SPACE.lg : SPACE.xxl * 2, gap: SPACE.lg, maxWidth: PAGE_MAX_WIDTH, width: "100%", alignSelf: "center" }}
      >
        <View style={{ gap: SPACE.sm }}>
          <BackLink theme={theme} label="All projects" disabled={busy} onPress={onBack} />
          <Text style={{ color: colors.foreground, fontSize: wide ? FONT_SIZE.display : FONT_SIZE.heading, fontWeight: "700" }}>{`Add ${candidate?.name ?? draft.project}`}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>
            Taro filled these in from the repository. Create it now, or change anything first.
          </Text>
        </View>

        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, padding: SPACE.lg, gap: SPACE.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }}>
              <Icon name="FolderGit2" size={16} color={colors.foreground} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: SPACE.xxs }}>
              <Text selectable numberOfLines={1} style={{ color: colors.foreground, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE }}>
                {draft.repoPath}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>
                {remote ?? (canSync ? "" : "No remote")}
              </Text>
            </View>
          </View>
          <Field theme={theme} wide={wide} label="Name" hint="What Taro calls the project, in its tabs and folders." error={problem("project")}>
            <TextField theme={theme} accessibilityLabel="Name" value={draft.project} onChangeText={(text) => update("project", text)} invalid={problem("project") !== null} />
          </Field>
          <Field
            theme={theme}
            wide={wide}
            label="Ticket prefix"
            hint={example === null ? "One to eight capital letters." : `Tickets will be numbered ${example}, ${example.replace(/001$/, "002")}…`}
            error={problem("ticketPrefix")}
          >
            <TextField
              theme={theme}
              accessibilityLabel="Ticket prefix"
              value={draft.ticketPrefix}
              onChangeText={(text) => update("ticketPrefix", text.toUpperCase())}
              invalid={problem("ticketPrefix") !== null}
            />
          </Field>
          <Field theme={theme} wide={wide} label="Base branch" hint={`The repository's default. Work starts from ${branch} and is delivered back to it.`} error={problem("baseBranch")}>
            <TextField theme={theme} accessibilityLabel="Base branch" value={draft.baseBranch} onChangeText={(text) => update("baseBranch", text)} invalid={problem("baseBranch") !== null} />
          </Field>
          <Field theme={theme} wide={wide} label="Tickets" hint={canSync ? null : "The repository has no remote, so tickets stay on this machine."}>
            {canSync ? (
              <ChoiceCards
                theme={theme}
                value={draft.trackerSync}
                onChange={(value) => update("trackerSync", value)}
                options={[
                  { value: "remote", title: "Synced with the remote", description: "Your other machines see the same board." },
                  { value: "local", title: "This machine only", description: "Nothing is pushed." },
                ]}
              />
            ) : (
              <Text style={[muted, { color: colors.foreground, paddingTop: wide ? SPACE.sm : 0 }]}>This machine only</Text>
            )}
          </Field>
          <Field theme={theme} wide={wide} label="Agents and delivery" hint={deliveryHint(template, pullRequests)}>
            <Text style={[muted, { color: colors.foreground, paddingTop: wide ? SPACE.sm : 0 }]}>{summary}</Text>
          </Field>
        </View>
        {compact ? null : footer}
      </KeyboardScrollView>
      {compact ? (
        // On a phone Create stays in reach at the bottom while the fields scroll.
        <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0 }}>{footer}</View>
      ) : null}
    </View>
  );
}

/**
 * A copy of the creation progress, read again a few times a second since the calls write it outside
 * React; `refresh` reads it at once, after a change made here.
 */
export function useCreation(): { state: CreationState; refresh: () => void } {
  const [snapshot, setSnapshot] = useState<CreationState>(() => ({ ...creation }));
  const refresh = () =>
    setSnapshot((current) =>
      current.project === creation.project && current.step === creation.step && current.error === creation.error && current.failedStep === creation.failedStep
        ? current
        : { ...creation },
    );
  useEffect(() => {
    const timer = setInterval(refresh, 300);
    return () => clearInterval(timer);
  }, []);
  return { state: snapshot, refresh };
}

/** The new project's page while its tracker and Manager are set up; the screen opens its Manager tab when done. */
export function CreationProgress({
  theme,
  state,
  onOpenProject,
  onBackToSetup,
}: {
  theme: PluginTheme;
  state: CreationState;
  onOpenProject: (project: string) => void;
  onBackToSetup: (error: string) => void;
}) {
  const launch = useRpc(launchManager);
  const colors = theme.colors;
  const project = state.project ?? "";
  const failedAt = state.step === "failed" ? state.failedStep : null;
  const order = ["tracker", "manager", "done"] as const;
  const reached = state.step === "failed" ? (state.failedStep ?? "tracker") : state.step === "idle" ? "tracker" : state.step;
  const position = order.indexOf(reached);

  const line = (step: "check" | "tracker" | "manager", label: string) => {
    const index = step === "check" ? -1 : order.indexOf(step);
    const failed = failedAt === step;
    const done = index < position || state.step === "done";
    const active = !failed && !done && index === position;
    return (
      <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <View style={{ width: 18, alignItems: "center" }}>
          {failed ? (
            <Icon name="CircleX" size={16} color={colors.statusDanger} />
          ) : done ? (
            <Icon name="CircleCheck" size={16} color={colors.statusSuccess} />
          ) : active ? (
            <Spinner size={14} color={colors.accent} />
          ) : (
            <Icon name="Circle" size={16} color={colors.foregroundMuted} />
          )}
        </View>
        <Text style={{ color: done || active || failed ? colors.foreground : colors.foregroundMuted, fontSize: FONT_SIZE.body }}>{label}</Text>
      </View>
    );
  };

  return (
    <KeyboardScrollView contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.lg, maxWidth: PAGE_MAX_WIDTH, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: SPACE.sm }}>
        <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.heading, fontWeight: "700" }}>{failedAt === null ? `Setting up ${project}` : `${project} is not ready`}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>
          {failedAt === null ? "Its Manager opens here as soon as it has started; this takes a few seconds." : "Nothing else was changed in the repository."}
        </Text>
      </View>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, padding: SPACE.lg, gap: SPACE.md }}>
        {line("check", "Checked the repository")}
        {line("tracker", "Setting up the ticket tracker")}
        {line("manager", "Starting the Manager")}
        {state.error === null ? null : (
          <Text selectable style={{ color: colors.statusDanger, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>
            {state.error}
          </Text>
        )}
      </View>
      {failedAt === "tracker" ? (
        <View style={{ flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" }}>
          <IconButton theme={theme} tone="accent" icon="ChevronLeft" label="Back to the project's settings" showLabel onPress={() => onBackToSetup(state.error ?? "")} />
        </View>
      ) : null}
      {failedAt === "manager" ? (
        <View style={{ flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" }}>
          <IconButton theme={theme} tone="accent" icon="RotateCcw" label="Start the Manager again" showLabel onPress={() => void retryManager({ launch })} />
          <IconButton theme={theme} icon="ArrowRight" label={`Open ${project} without it`} showLabel onPress={() => onOpenProject(project)} />
        </View>
      ) : null}
    </KeyboardScrollView>
  );
}
