import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildFeed,
  draftReply,
  loadMessages,
  loadRuntimeState,
  loadStateEvents,
  runAgenticWorkflow,
  runAutonomousMonitor,
  savePreferences,
  sendReply,
} from "./autonomousInboxApi";
import { DEFAULT_PREFERENCES } from "./AutonomousAgentsWorkingView";

const EMPTY_PARAMS = {};

function setNestedValue(object, path, value) {
  const keys = path.split(".");
  const result = { ...object };
  let pointer = result;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    pointer[key] = { ...(pointer[key] || {}) };
    pointer = pointer[key];
  }

  pointer[keys[keys.length - 1]] = value;
  return result;
}

function resolveMaterialContext(runtimeState, event) {
  const workspace = runtimeState?.canvas?.normalizedWorkspace;
  const courseId = String(event?.course_id || "");
  const detail = event?.detail || {};
  const moduleId = String(detail.moduleId || "");
  const course = workspace?.byId?.courses?.[courseId] || null;
  const module = workspace?.byId?.modules?.[moduleId] || null;
  const moduleItems = workspace?.moduleItems || [];
  const item =
    moduleItems.find((entry) => String(entry.id) === String(event?.entity_id || "")) ||
    moduleItems.find((entry) => String(entry.content_id || "") === String(event?.entity_id || "")) ||
    moduleItems.find(
      (entry) =>
        String(entry.module_id || "") === moduleId &&
        String(entry.display_name || "").trim() === String(event?.title || "").trim()
    ) ||
    null;

  return {
    eventId: event?.id,
    eventType: event?.event_type,
    courseId,
    courseName: course?.name || `Course ${courseId}`,
    moduleId: moduleId || item?.module_id || "",
    moduleName: module?.name || detail.moduleName || item?.module_name || "Module",
    topicId: item?.id ? String(item.id) : null,
    fileName: item?.display_name || event?.title || "New material",
    entityId: event?.entity_id || null,
    createdAt: event?.created_at || null,
    subtitle:
      event?.event_type === "new_module_posted"
        ? "Professor posted a new module"
        : "Professor posted new course material",
  };
}

export default function useAutonomousInboxFeed(initialParams, currentUserName = "") {
  const stableParams = initialParams || EMPTY_PARAMS;
  const [runtimeState, setRuntimeState] = useState(null);
  const [rawMessages, setRawMessages] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [stateEvents, setStateEvents] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [materialWorkflow, setMaterialWorkflow] = useState(null);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [draftingMessageId, setDraftingMessageId] = useState(null);
  const [sendingMessageId, setSendingMessageId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runtimeResult, messagesResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
      ]);
      const eventsResult = await loadStateEvents(40).catch(() => []);

      if (messagesResult.status === "fulfilled") {
        setRawMessages(messagesResult.value || []);
      } else {
        setRawMessages([]);
      }

      if (runtimeResult.status === "fulfilled") {
        setRuntimeState(runtimeResult.value);
      } else {
        setRuntimeState(null);
        if (messagesResult.status !== "fulfilled") {
          throw runtimeResult.reason;
        }
        setError(runtimeResult.reason?.message || "Runtime state unavailable, showing raw inbox only");
      }
      setStateEvents(eventsResult || []);
    } catch (err) {
      setError(err.message || "Failed to load autonomous inbox state");
    } finally {
      setLoading(false);
    }
  }, [stableParams]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      await runAutonomousMonitor();
      const [runtimeResult, messagesResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
      ]);
      const eventsResult = await loadStateEvents(40).catch(() => []);

      if (messagesResult.status === "fulfilled") {
        setRawMessages(messagesResult.value || []);
      } else {
        setRawMessages([]);
      }

      if (runtimeResult.status === "fulfilled") {
        setRuntimeState(runtimeResult.value);
      } else {
        setRuntimeState(null);
        if (messagesResult.status !== "fulfilled") {
          throw runtimeResult.reason;
        }
        setError(runtimeResult.reason?.message || "Runtime state unavailable, showing raw inbox only");
      }
      setStateEvents(eventsResult || []);
    } catch (err) {
      setError(err.message || "Failed to sync autonomous inbox state");
    } finally {
      setSyncing(false);
    }
  }, [stableParams]);

  const onPreferenceChange = useCallback(async (path, value) => {
    const next = setNestedValue(preferences, path, value);
    setPreferences(next);
    try {
      await savePreferences(next);
    } catch (err) {
      setError(err.message || "Failed to save preferences");
    }
  }, [preferences]);

  const onDraftReply = useCallback(async (item) => {
    if (!item?.id) return;
    setDraftingMessageId(item.id);
    setError("");
    try {
      const result = await draftReply(item.id);
      setDrafts((current) => ({
        ...current,
        [item.id]: result.draft || "",
      }));
    } catch (err) {
      setError(err.message || "Failed to draft reply");
    } finally {
      setDraftingMessageId(null);
    }
  }, []);

  const onSendReply = useCallback(async (item) => {
    if (!item?.id) return;
    setSendingMessageId(item.id);
    setError("");
    let draft = drafts[item.id];
    if (!draft) {
      try {
        const result = await draftReply(item.id);
        draft = result.draft || "";
        setDrafts((current) => ({
          ...current,
          [item.id]: draft,
        }));
      } catch (err) {
        setError(err.message || "Failed to draft reply before sending");
        setSendingMessageId(null);
        return;
      }
    }

    try {
      await sendReply(item.id, draft);
      await syncNow();
    } catch (err) {
      setError(err.message || "Failed to send reply");
    } finally {
      setSendingMessageId(null);
    }
  }, [drafts, syncNow]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const feed = useMemo(
    () => buildFeed(runtimeState, preferences, rawMessages, currentUserName),
    [runtimeState, preferences, rawMessages, currentUserName]
  );

  const materialCards = useMemo(
    () =>
      (stateEvents || [])
        .filter(
          (event) =>
            event?.event_type === "new_material_posted" || event?.event_type === "new_module_posted"
        )
        .map((event) => resolveMaterialContext(runtimeState, event))
        .filter((item) => item.courseId),
    [runtimeState, stateEvents]
  );

  const onOpenMaterial = useCallback(
    async (item) => {
      if (!item?.courseId) return;
      setSelectedMaterial(item);
      setMaterialWorkflow(null);
      setMaterialLoading(true);
      setError("");
      try {
        const workflow = await runAgenticWorkflow({
          courseId: item.courseId,
          moduleId: item.moduleId || null,
          topicId: item.topicId || null,
          workflowType: item.topicId ? "topic_deep_dive" : "module_mastery",
          preferences,
        });
        setMaterialWorkflow(workflow);
      } catch (err) {
        setError(err.message || "Failed to generate learning material");
      } finally {
        setMaterialLoading(false);
      }
    },
    [preferences]
  );

  return {
    drafts,
    error,
    feed,
    loading,
    materialCards,
    materialLoading,
    materialWorkflow,
    draftingMessageId,
    onOpenMaterial,
    onDraftReply,
    onPreferenceChange,
    onSendReply,
    preferences,
    rawMessages,
    refresh,
    runtimeState,
    selectedMaterial,
    sendingMessageId,
    syncNow,
    syncing,
  };
}
