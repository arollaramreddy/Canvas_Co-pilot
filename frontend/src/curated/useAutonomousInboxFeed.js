import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildFeed,
  draftReply,
  loadDashboardMaterials,
  loadMessages,
  loadRuntimeState,
  loadStateEvents,
  runAutonomousMonitor,
  retryDashboardMaterial,
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

export default function useAutonomousInboxFeed(initialParams, currentUserName = "") {
  const stableParams = initialParams || EMPTY_PARAMS;
  const [runtimeState, setRuntimeState] = useState(null);
  const [rawMessages, setRawMessages] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [stateEvents, setStateEvents] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [selectedMaterialView, setSelectedMaterialView] = useState("summary");
  const [dashboardMaterials, setDashboardMaterials] = useState([]);
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
      const [runtimeResult, messagesResult, materialsResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
        loadDashboardMaterials(24),
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
      setDashboardMaterials(materialsResult.status === "fulfilled" ? materialsResult.value || [] : []);
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
      const [runtimeResult, messagesResult, materialsResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
        loadDashboardMaterials(24),
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
      setDashboardMaterials(materialsResult.status === "fulfilled" ? materialsResult.value || [] : []);
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
    () => dashboardMaterials,
    [dashboardMaterials]
  );

  const onOpenMaterial = useCallback(
    async (item, view = "summary") => {
      if (!item?.id) return;
      setSelectedMaterial(item);
      setSelectedMaterialView(view);
    },
    []
  );

  const onRetryMaterial = useCallback(async (item) => {
    if (!item?.id) return;
    setMaterialLoading(true);
    setError("");
    try {
      await retryDashboardMaterial(item.id);
      await syncNow();
    } catch (err) {
      setError(err.message || "Failed to retry dashboard material");
    } finally {
      setMaterialLoading(false);
    }
  }, [syncNow]);

  useEffect(() => {
    if (!selectedMaterial?.id) return;
    const nextSelected = (dashboardMaterials || []).find(
      (item) => String(item.id) === String(selectedMaterial.id)
    );
    if (nextSelected) {
      setSelectedMaterial(nextSelected);
    }
  }, [dashboardMaterials, selectedMaterial?.id]);

  return {
    drafts,
    error,
    feed,
    loading,
    materialCards,
    materialLoading,
    draftingMessageId,
    onOpenMaterial,
    onDraftReply,
    onPreferenceChange,
    onRetryMaterial,
    onSendReply,
    preferences,
    rawMessages,
    refresh,
    runtimeState,
    selectedMaterial,
    selectedMaterialView,
    sendingMessageId,
    syncNow,
    syncing,
  };
}
